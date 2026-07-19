import { Keypair, WebAuth } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnchorError } from '../src/errors.js';
import { networkPassphrase } from '../src/horizonClient.js';
import { requestChallenge, submitSignedChallenge } from '../src/sep10.js';

/**
 * Exercises Giffy's SEP-10 client against controlled anchor responses.
 *
 * Per README §18.5 these assert on how *our* code reacts to what an anchor returns,
 * not on what the reference anchor happens to return — that surface belongs to the
 * anchor. The live handshake is covered in sep10.integration.test.ts.
 */

const WEB_AUTH_ENDPOINT = 'https://testanchor.stellar.org/auth';
const HOME_DOMAIN = 'testanchor.stellar.org';

const anchorKeypair = Keypair.random();
const clientKeypair = Keypair.random();

function buildRealChallenge(
  clientAccount: string = clientKeypair.publicKey(),
  homeDomain: string = HOME_DOMAIN,
): string {
  return WebAuth.buildChallengeTx(
    anchorKeypair,
    clientAccount,
    homeDomain,
    300,
    networkPassphrase,
    'testanchor.stellar.org',
  );
}

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  body: unknown;
  text?: string;
}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve({
        ok: response.ok ?? true,
        status: response.status ?? 200,
        text: async () => response.text ?? JSON.stringify(response.body),
      } as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestChallenge', () => {
  it('returns the unsigned challenge XDR for the wallet to sign', async () => {
    const challenge = buildRealChallenge();
    mockFetch({ body: { transaction: challenge, network_passphrase: networkPassphrase } });

    const xdr = await requestChallenge(
      WEB_AUTH_ENDPOINT,
      clientKeypair.publicKey(),
      HOME_DOMAIN,
      anchorKeypair.publicKey(),
    );

    expect(xdr).toBe(challenge);
  });

  it('requests the challenge for the given account and home domain', async () => {
    mockFetch({ body: { transaction: buildRealChallenge() } });

    await requestChallenge(WEB_AUTH_ENDPOINT, clientKeypair.publicKey(), HOME_DOMAIN);

    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain(`account=${clientKeypair.publicKey()}`);
    expect(calledUrl).toContain('home_domain=testanchor.stellar.org');
  });

  it("rejects a challenge not signed by the anchor's advertised signing key", async () => {
    // The core of SEP-10's security: without this check, a spoofed anchor response
    // could induce the user's wallet to sign an attacker-chosen transaction.
    const impostor = Keypair.random();
    mockFetch({ body: { transaction: buildRealChallenge() } });

    await expect(
      requestChallenge(
        WEB_AUTH_ENDPOINT,
        clientKeypair.publicKey(),
        HOME_DOMAIN,
        impostor.publicKey(),
      ),
    ).rejects.toBeInstanceOf(AnchorError);
  });

  it('rejects a challenge issued for a different account', async () => {
    const someoneElse = Keypair.random();
    mockFetch({ body: { transaction: buildRealChallenge(someoneElse.publicKey()) } });

    await expect(
      requestChallenge(
        WEB_AUTH_ENDPOINT,
        clientKeypair.publicKey(),
        HOME_DOMAIN,
        anchorKeypair.publicKey(),
      ),
    ).rejects.toThrow(/different account/i);
  });

  it('rejects a challenge issued for a different home domain', async () => {
    mockFetch({ body: { transaction: buildRealChallenge(clientKeypair.publicKey(), 'evil.example') } });

    await expect(
      requestChallenge(
        WEB_AUTH_ENDPOINT,
        clientKeypair.publicKey(),
        HOME_DOMAIN,
        anchorKeypair.publicKey(),
      ),
    ).rejects.toBeInstanceOf(AnchorError);
  });

  it('rejects a challenge minted for a different Stellar network', async () => {
    mockFetch({
      body: {
        transaction: buildRealChallenge(),
        network_passphrase: 'Public Global Stellar Network ; September 2015',
      },
    });

    await expect(
      requestChallenge(WEB_AUTH_ENDPOINT, clientKeypair.publicKey(), HOME_DOMAIN),
    ).rejects.toThrow(/different Stellar network/i);
  });

  it('surfaces the anchor error message on a rejected request', async () => {
    mockFetch({ ok: false, status: 400, body: { error: 'account is banned' } });

    await expect(
      requestChallenge(WEB_AUTH_ENDPOINT, clientKeypair.publicKey(), HOME_DOMAIN),
    ).rejects.toThrow(/account is banned/);
  });

  it('rejects a malformed public key before making a request', async () => {
    mockFetch({ body: {} });

    await expect(requestChallenge(WEB_AUTH_ENDPOINT, 'not-a-key', HOME_DOMAIN)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a non-JSON response without leaking a parser stack trace', async () => {
    mockFetch({ ok: false, status: 502, body: null, text: '<html>Bad Gateway</html>' });

    await expect(
      requestChallenge(WEB_AUTH_ENDPOINT, clientKeypair.publicKey(), HOME_DOMAIN),
    ).rejects.toThrow(/non-JSON response/i);
  });

  it('wraps a network failure as an AnchorError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))),
    );

    await expect(
      requestChallenge(WEB_AUTH_ENDPOINT, clientKeypair.publicKey(), HOME_DOMAIN),
    ).rejects.toBeInstanceOf(AnchorError);
  });
});

describe('submitSignedChallenge', () => {
  it('returns the anchor JWT', async () => {
    mockFetch({ body: { token: 'jwt.token.value' } });

    const jwt = await submitSignedChallenge(WEB_AUTH_ENDPOINT, 'signed-xdr');

    expect(jwt).toBe('jwt.token.value');
  });

  it('posts the signed transaction to the anchor', async () => {
    mockFetch({ body: { token: 'jwt' } });

    await submitSignedChallenge(WEB_AUTH_ENDPOINT, 'signed-xdr');

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ transaction: 'signed-xdr' });
  });

  it('surfaces the anchor error on a rejected signature', async () => {
    mockFetch({ ok: false, status: 401, body: { error: 'invalid signature' } });

    await expect(submitSignedChallenge(WEB_AUTH_ENDPOINT, 'signed-xdr')).rejects.toThrow(
      /invalid signature/,
    );
  });

  it('errors when the anchor returns no token', async () => {
    mockFetch({ body: {} });

    await expect(submitSignedChallenge(WEB_AUTH_ENDPOINT, 'signed-xdr')).rejects.toBeInstanceOf(
      AnchorError,
    );
  });
});
