import { Horizon } from '@stellar/stellar-sdk';

import { config } from './config.js';

/**
 * The single shared Horizon server instance (README §9.2).
 *
 * Every other file in this layer imports this rather than constructing its own,
 * so timeouts, retries, and any future instrumentation are configured once.
 */
export const horizon = new Horizon.Server(config.HORIZON_URL, {
  // Testnet Horizon is served over HTTPS; this only relaxes for a local instance.
  allowHttp: config.HORIZON_URL.startsWith('http://'),
});

export const networkPassphrase = config.STELLAR_NETWORK_PASSPHRASE;

/** Shared timeout for outbound HTTP this layer makes itself (SEP-1/10/24). */
export const requestTimeoutMs = config.HORIZON_REQUEST_TIMEOUT_MS;

/**
 * `fetch` with the configured timeout applied.
 *
 * The Stellar SDK manages its own timeouts for Horizon calls, but the SEP clients
 * talk to anchor infrastructure directly — an anchor that accepts a connection and
 * then never responds would otherwise hang a request indefinitely.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = requestTimeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
