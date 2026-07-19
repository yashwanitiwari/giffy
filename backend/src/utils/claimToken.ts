import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '../config/env.js';

/**
 * Claim token generation and hashing (README §17.2).
 *
 * The token is 256 bits of CSPRNG output, base64url-encoded for URL safety, and
 * deliberately unrelated to the on-chain `contractGiftId` — unlike this token, the
 * contract id is a small sequential integer and public ledger data, so it would be
 * trivially guessable if used as an access token on its own.
 *
 * Only the SHA-256 digest is ever persisted. The raw token exists in the URL handed
 * to the sender and nowhere else: not in the database, not in logs, not in analytics.
 */

/** Base64url alphabet, fixed length for the configured byte count. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export function generateClaimToken(): string {
  return randomBytes(env.CLAIM_TOKEN_BYTES).toString('base64url');
}

export function hashClaimToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * Cheap shape check before a token reaches the database.
 *
 * Purely a load shedder for the public claim route: it rejects obvious junk without
 * a query. It is not a security control — a well-formed guess still has to survive
 * the hash lookup, which is where the 256 bits of entropy actually do the work.
 */
export function isWellFormedClaimToken(rawToken: unknown): rawToken is string {
  return (
    typeof rawToken === 'string' &&
    rawToken.length > 0 &&
    rawToken.length <= 128 &&
    TOKEN_PATTERN.test(rawToken)
  );
}

/**
 * Constant-time digest comparison (§10.4).
 *
 * The lookup itself is an indexed equality match on the hash, which MongoDB does not
 * promise to run in constant time. Any timing signal there leaks at most a few bits
 * about a *hash* — not the token — so this is defense in depth on top of the token's
 * own entropy rather than the control that makes guessing infeasible.
 */
export function claimTokenHashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // timingSafeEqual throws on length mismatch; equal-length digests are the only
  // case worth comparing carefully anyway.
  if (bufA.length !== bufB.length) return false;

  return timingSafeEqual(bufA, bufB);
}
