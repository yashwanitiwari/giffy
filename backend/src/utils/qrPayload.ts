import { env } from '../config/env.js';

/**
 * Claim URL and QR payload construction (README §11.1).
 *
 * The backend returns only the URL string; the frontend renders the QR image
 * client-side with `qrcode.react`. There is no reason to ship a PNG from the server
 * when the payload is a short URL the client can encode itself.
 */

export function buildClaimUrl(rawToken: string): string {
  // The base URL is validated as a URL at config load, so a trailing-slash mismatch
  // is the only way to get a malformed link here.
  const base = env.CLAIM_LINK_BASE_URL.replace(/\/+$/, '');
  return `${base}/${rawToken}`;
}

/**
 * What the QR encodes. Identical to the claim URL today, and kept as its own
 * function because it is the natural seam if a future gift card ever needs to encode
 * something richer than a bare link.
 */
export function buildQrPayload(claimUrl: string): string {
  return claimUrl;
}

/**
 * The group-contribution page URL for a gift (README §15.1), returned alongside the
 * claim link only when `isGroupGift` was `true` at creation.
 */
export function buildContributeUrl(giftId: string): string {
  const base = env.CONTRIBUTE_LINK_BASE_URL.replace(/\/+$/, '');
  return `${base}/${giftId}/contribute`;
}
