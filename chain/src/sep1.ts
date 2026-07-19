import { StellarToml } from '@stellar/stellar-sdk';

import { AnchorError } from './errors.js';
import type { StellarTomlInfo } from './types.js';

/** One hour: anchor infrastructure changes rarely, and a stale entry self-heals. */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  value: StellarTomlInfo;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Resolves an anchor's SEP-1 stellar.toml into the endpoints Giffy needs.
 *
 * Resolving rather than hardcoding endpoint URLs (README §5.2) keeps the
 * integration correct if the anchor ever moves its infrastructure — the home domain
 * is the only thing Giffy configures.
 *
 * Results are cached in-memory per domain; there is no need to refetch this on
 * every on-ramp session.
 */
export async function resolveStellarToml(homeDomain: string): Promise<StellarTomlInfo> {
  if (!homeDomain) {
    throw new AnchorError('An anchor home domain is required.');
  }

  const domain = normalizeDomain(homeDomain);
  const cached = cache.get(domain);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let toml: StellarToml.Api.StellarToml;
  try {
    toml = await StellarToml.Resolver.resolve(domain);
  } catch (err) {
    throw new AnchorError(
      `Could not resolve the anchor's stellar.toml at ${domain}.`,
      err,
    );
  }

  const webAuthEndpoint = toml.WEB_AUTH_ENDPOINT;
  const transferServerSep24 = toml.TRANSFER_SERVER_SEP0024;
  const signingKey = toml.SIGNING_KEY;

  // Missing any of these means the domain is not a usable SEP-24 anchor. Fail here
  // with a clear message rather than letting `undefined` reach a fetch() call.
  if (!webAuthEndpoint) {
    throw new AnchorError(`The anchor at ${domain} publishes no WEB_AUTH_ENDPOINT (SEP-10).`);
  }
  if (!transferServerSep24) {
    throw new AnchorError(
      `The anchor at ${domain} publishes no TRANSFER_SERVER_SEP0024 (SEP-24).`,
    );
  }
  if (!signingKey) {
    throw new AnchorError(`The anchor at ${domain} publishes no SIGNING_KEY.`);
  }

  const value: StellarTomlInfo = {
    webAuthEndpoint: stripTrailingSlash(webAuthEndpoint),
    transferServerSep24: stripTrailingSlash(transferServerSep24),
    signingKey,
    currencies: (toml.CURRENCIES ?? []).flatMap((currency) => {
      if (!currency.code) return [];
      return [
        {
          code: currency.code,
          ...(currency.issuer ? { issuer: currency.issuer } : {}),
        },
      ];
    }),
  };

  cache.set(domain, { value, expiresAt: Date.now() + CACHE_TTL_MS });

  return value;
}

/** Looks up an anchored currency's issuer from the anchor's own toml. */
export async function resolveAnchoredAssetIssuer(
  homeDomain: string,
  assetCode: string,
): Promise<string> {
  const { currencies } = await resolveStellarToml(homeDomain);
  const match = currencies.find((currency) => currency.code === assetCode);

  if (!match?.issuer) {
    throw new AnchorError(`The anchor at ${homeDomain} does not anchor an asset called ${assetCode}.`);
  }

  return match.issuer;
}

/** Clears the cache. Exists for tests; production code should let the TTL do its job. */
export function clearStellarTomlCache(): void {
  cache.clear();
}

function normalizeDomain(homeDomain: string): string {
  return homeDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
