import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';

/**
 * Per-IP throttling (README §10.6).
 *
 * Two limiters, because the two route families face different traffic. Sender routes
 * are driven by a wallet-holding human doing deliberate work. The public claim
 * preview is an unauthenticated endpoint on a guessable-looking URL, and must assume
 * adversarial traffic (§10.1).
 */

const errorResponse = {
  error: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please slow down and try again shortly.',
  },
};

/**
 * The stricter limiter, for `GET /api/claim/:token`.
 *
 * Defense in depth rather than the primary control (§15.2): 256 bits of entropy is
 * what makes enumeration infeasible, and no rate limit would save a token scheme with
 * less. What this does buy is a bound on the blast radius if a future token-generation
 * bug ever narrows that entropy without anyone noticing.
 */
export const claimPreviewLimiter = rateLimit({
  windowMs: env.CLAIM_PREVIEW_RATE_LIMIT_WINDOW_MS,
  limit: env.CLAIM_PREVIEW_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: errorResponse,
});

/** The lenient limiter, for the sender's own gift routes. */
export const giftRoutesLimiter = rateLimit({
  windowMs: env.GIFT_ROUTES_RATE_LIMIT_WINDOW_MS,
  limit: env.GIFT_ROUTES_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: errorResponse,
});
