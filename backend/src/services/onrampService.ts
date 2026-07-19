import { randomBytes } from 'node:crypto';

import {
  initiateInteractiveDeposit,
  pollTransactionStatus,
  requestChallenge as requestAnchorChallenge,
  resolveStellarToml,
  submitSignedChallenge,
} from '@giffy/chain';
import { Types } from 'mongoose';

import { env } from '../config/env.js';
import { Sep24SessionModel, sessionExpiryFromNow } from '../models/Sep24Session.js';
import { hashClaimToken } from '../utils/claimToken.js';
import { SessionNotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * The SEP-10/SEP-24 on-ramp (README §10.4, §5).
 *
 * This service is the reason the anchor's JWT never reaches the browser. The
 * frontend authenticates the *user's wallet* to the anchor by signing a challenge,
 * but the resulting bearer token is redeemed and held here; the frontend gets an
 * opaque handle and asks this backend to act with it (§15.7).
 *
 * The protocol exchange is real and spec-compliant against an independently-operated
 * anchor. What is not real is the money: `testanchor.stellar.org` mocks the banking
 * side on purpose (§5.5), and no copy anywhere should imply otherwise.
 */

export interface ChallengeResult {
  xdr: string;
}

/**
 * Requests a SEP-10 challenge for the user's wallet to sign.
 *
 * The anchor's endpoints and signing key come from its stellar.toml rather than being
 * hardcoded (§5.2), so the integration survives the anchor moving its infrastructure.
 * Passing `signingKey` through is what lets the chain layer verify the challenge is
 * genuinely the anchor's before Giffy asks a user to sign it.
 */
export async function requestChallenge(publicKey: string): Promise<ChallengeResult> {
  const toml = await resolveStellarToml(env.ANCHOR_HOME_DOMAIN);

  const xdr = await requestAnchorChallenge(
    toml.webAuthEndpoint,
    publicKey,
    env.ANCHOR_HOME_DOMAIN,
    toml.signingKey,
  );

  logger.info({ publicKey }, 'SEP-10 challenge issued');

  return { xdr };
}

/**
 * Exchanges the wallet-signed challenge for the anchor's JWT and opens a session.
 *
 * Returns an opaque token, never the JWT. The JWT is stored `select: false` and only
 * ever loaded by the two functions below that actually need to call the anchor.
 */
export async function submitChallenge(
  publicKey: string,
  signedXdr: string,
): Promise<{ sessionToken: string }> {
  const toml = await resolveStellarToml(env.ANCHOR_HOME_DOMAIN);

  const anchorJwt = await submitSignedChallenge(toml.webAuthEndpoint, signedXdr);

  const sessionToken = randomBytes(32).toString('base64url');

  const session = await Sep24SessionModel.create({
    senderPublicKey: publicKey,
    anchorJwt,
    sessionTokenHash: hashClaimToken(sessionToken),
    status: 'incomplete',
    expiresAt: sessionExpiryFromNow(),
  });

  logger.info({ sessionId: session.id, publicKey }, 'SEP-10 session opened');

  return { sessionToken };
}

/**
 * Starts the anchor-hosted deposit and returns the URL for the frontend to open.
 *
 * Giffy does not render this screen — SEP-24 hands the customer-information step to
 * the anchor by design, and building a lookalike would mean collecting exactly the
 * data the spec exists to keep out of the wallet's hands (§5.4).
 */
export async function initiateDeposit(
  sessionToken: string,
  assetCode: string,
): Promise<{ sessionId: string; interactiveUrl: string }> {
  const session = await findSessionByToken(sessionToken);

  const toml = await resolveStellarToml(env.ANCHOR_HOME_DOMAIN);

  const { id, interactiveUrl } = await initiateInteractiveDeposit({
    transferServerUrl: toml.transferServerSep24,
    jwt: session.anchorJwt,
    assetCode,
    account: session.senderPublicKey,
  });

  session.assetCode = assetCode;
  session.anchorTransactionId = id;
  session.interactiveUrl = interactiveUrl;
  await session.save();

  logger.info({ sessionId: session.id, anchorTransactionId: id, assetCode }, 'SEP-24 deposit started');

  return { sessionId: session.id, interactiveUrl };
}

/**
 * Reads the deposit's current status from the anchor.
 *
 * Keyed by the session's own id rather than the anchor's transaction id, so the
 * polling endpoint stays a Giffy-scoped resource. The anchor's status string is
 * persisted and returned verbatim (§14.3) — an unrecognized status from a
 * spec-compliant anchor should surface as itself, not collapse into "error".
 */
export async function getDepositStatus(
  sessionId: string,
): Promise<{ status: string; stellarTransactionId?: string; message?: string }> {
  if (!Types.ObjectId.isValid(sessionId)) {
    throw new SessionNotFoundError();
  }

  const session = await Sep24SessionModel.findById(sessionId).select('+anchorJwt').exec();

  if (!session || !session.anchorTransactionId) {
    throw new SessionNotFoundError();
  }

  const toml = await resolveStellarToml(env.ANCHOR_HOME_DOMAIN);

  const result = await pollTransactionStatus({
    transferServerUrl: toml.transferServerSep24,
    jwt: session.anchorJwt,
    transactionId: session.anchorTransactionId,
  });

  if (result.status !== session.status) {
    session.status = result.status;
    await session.save();
    logger.info({ sessionId: session.id, status: result.status }, 'SEP-24 status advanced');
  }

  return {
    status: result.status,
    ...(result.stellarTransactionId ? { stellarTransactionId: result.stellarTransactionId } : {}),
    ...(result.message ? { message: result.message } : {}),
  };
}

async function findSessionByToken(sessionToken: string) {
  const session = await Sep24SessionModel.findOne({ sessionTokenHash: hashClaimToken(sessionToken) })
    .select('+anchorJwt')
    .exec();

  if (!session) {
    throw new SessionNotFoundError();
  }

  // The TTL index reaps expired sessions, but Mongo's reaper runs on its own
  // schedule — checking here means an expired session never gets used in the window
  // between its expiry and its deletion.
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new SessionNotFoundError();
  }

  return session;
}
