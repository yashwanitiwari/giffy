import { WebAuth } from '@stellar/stellar-sdk';

import { assertValidPublicKey } from './accounts.js';
import { AnchorError } from './errors.js';
import { fetchWithTimeout, networkPassphrase } from './horizonClient.js';
import type { Xdr } from './types.js';

/**
 * SEP-10 Stellar Web Authentication (README §5.3).
 *
 * This file handles only the HTTP exchange with the anchor and the verification of
 * what the anchor sent back. It never signs the challenge — that happens in the
 * user's own wallet, client-side, per the non-custodial invariant (README §15.3).
 */

interface ChallengeResponse {
  transaction?: string;
  network_passphrase?: string;
  error?: string;
}

interface TokenResponse {
  token?: string;
  error?: string;
}

/**
 * Requests a SEP-10 challenge transaction for `publicKey`.
 *
 * The returned XDR is a signable artifact, never submitted to the network — it
 * carries a random nonce in a manage_data op, and the user's signature over it is
 * what proves they control the account.
 *
 * The anchor's own signature and the challenge's structure are verified here before
 * the XDR is handed onward: without this check, a hijacked or spoofed anchor
 * response could induce the user's wallet to sign an attacker-chosen transaction.
 *
 * @returns unsigned challenge XDR for the frontend to sign via Freighter.
 */
export async function requestChallenge(
  webAuthEndpoint: string,
  publicKey: string,
  homeDomain: string,
  serverSigningKey?: string,
): Promise<Xdr> {
  assertValidPublicKey(publicKey);

  const url = new URL(webAuthEndpoint);
  url.searchParams.set('account', publicKey);
  url.searchParams.set('home_domain', homeDomain);

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new AnchorError('Could not reach the anchor to request a SEP-10 challenge.', err);
  }

  const body = (await readJson(response)) as ChallengeResponse;

  if (!response.ok || !body.transaction) {
    throw new AnchorError(
      body.error ?? `The anchor refused to issue a SEP-10 challenge (HTTP ${response.status}).`,
      body,
    );
  }

  // A challenge issued for a different network would be signed by the wallet under
  // the wrong passphrase and rejected later with a much more confusing error.
  if (body.network_passphrase && body.network_passphrase !== networkPassphrase) {
    throw new AnchorError(
      `The anchor issued a challenge for a different Stellar network (${body.network_passphrase}).`,
    );
  }

  if (serverSigningKey) {
    verifyChallenge({
      challengeXdr: body.transaction,
      serverSigningKey,
      publicKey,
      homeDomain,
      webAuthEndpoint,
    });
  }

  return body.transaction;
}

/**
 * Verifies a challenge is well-formed, signed by the anchor, and issued to us.
 *
 * `readChallengeTx` checks the anchor's signature, the operation structure, the
 * time bounds, and that the challenge names the expected home domain. We then check
 * the client account ourselves, so a challenge minted for a different account can
 * never be routed into this user's wallet.
 */
function verifyChallenge(params: {
  challengeXdr: Xdr;
  serverSigningKey: string;
  publicKey: string;
  homeDomain: string;
  webAuthEndpoint: string;
}): void {
  const { challengeXdr, serverSigningKey, publicKey, homeDomain, webAuthEndpoint } = params;

  let parsed: ReturnType<typeof WebAuth.readChallengeTx>;
  try {
    parsed = WebAuth.readChallengeTx(
      challengeXdr,
      serverSigningKey,
      networkPassphrase,
      [homeDomain],
      new URL(webAuthEndpoint).host,
    );
  } catch (err) {
    throw new AnchorError(
      'The SEP-10 challenge from the anchor failed verification and was not signed.',
      err,
    );
  }

  if (parsed.clientAccountID !== publicKey) {
    throw new AnchorError(
      'The SEP-10 challenge was issued for a different account than the one requested.',
    );
  }
}

/**
 * Exchanges a wallet-signed challenge for the anchor's JWT.
 *
 * The JWT is a bearer credential and stays server-side (README §15.7) — the backend
 * hands the frontend an opaque session reference instead.
 */
export async function submitSignedChallenge(
  webAuthEndpoint: string,
  signedXdr: Xdr,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchWithTimeout(webAuthEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ transaction: signedXdr }),
    });
  } catch (err) {
    throw new AnchorError('Could not reach the anchor to complete SEP-10 authentication.', err);
  }

  const body = (await readJson(response)) as TokenResponse;

  if (!response.ok || !body.token) {
    throw new AnchorError(
      body.error ?? `The anchor rejected the signed SEP-10 challenge (HTTP ${response.status}).`,
      body,
    );
  }

  return body.token;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Anchors are supposed to return JSON, but an error page or a proxy can return
    // HTML. Surface a bounded excerpt rather than a JSON.parse stack trace.
    throw new AnchorError(
      `The anchor returned a non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`,
    );
  }
}
