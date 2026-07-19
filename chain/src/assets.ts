import { Asset, StrKey } from '@stellar/stellar-sdk';

import { ChainError } from './errors.js';

/**
 * Known testnet issuers, centralized here rather than scattered through the
 * codebase (README §9.2) — reference-asset issuers can and do change, and this is
 * the single place to update them.
 *
 * Verified live against https://testanchor.stellar.org/.well-known/stellar.toml.
 * Treat these as a convenience default: `sep1.resolveStellarToml` is the
 * authoritative source at runtime, and should win if the two ever disagree.
 */
export const KNOWN_TESTNET_ASSETS: Record<string, { issuer: string }> = Object.freeze({
  /** Stellar Reference Token — the asset testanchor.stellar.org anchors. */
  SRT: { issuer: 'GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B' },
  /** Circle's testnet USDC, as listed by the reference anchor. */
  USDC: { issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
});

export const NATIVE_ASSET_CODE = 'XLM';

/**
 * Resolves an asset code (plus optional issuer) to an SDK `Asset`.
 *
 * `XLM` resolves to the native asset. Any other code needs an issuer: it is taken
 * from the argument when given, and otherwise falls back to `KNOWN_TESTNET_ASSETS`.
 * An unknown code with no issuer is an error rather than a guess — silently
 * resolving to the wrong issuer would lock funds into a different asset entirely.
 */
export function resolveAsset(code: string, issuer?: string | null): Asset {
  if (!code) {
    throw new ChainError('An asset code is required.');
  }

  if (code === NATIVE_ASSET_CODE || code.toLowerCase() === 'native') {
    if (issuer) {
      throw new ChainError('Native XLM has no issuer; remove the issuer to send XLM.');
    }
    return Asset.native();
  }

  const resolvedIssuer = issuer ?? KNOWN_TESTNET_ASSETS[code]?.issuer;

  if (!resolvedIssuer) {
    throw new ChainError(
      `Unknown asset "${code}": an issuer is required for any asset other than XLM.`,
    );
  }

  if (!StrKey.isValidEd25519PublicKey(resolvedIssuer)) {
    throw new ChainError(`Invalid issuer for asset "${code}": not a well-formed Stellar address.`);
  }

  return new Asset(code, resolvedIssuer);
}

/** Serializes an asset back to the `{ code, issuer }` pair the API layer stores. */
export function describeAsset(asset: Asset): { code: string; issuer: string | null } {
  return asset.isNative()
    ? { code: NATIVE_ASSET_CODE, issuer: null }
    : { code: asset.getCode(), issuer: asset.getIssuer() ?? null };
}

const AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;

/**
 * Validates a Stellar amount held as a decimal string (README §12.4).
 *
 * Amounts stay strings end-to-end and are only parsed at XDR-build time, so this
 * is a string-shape check by design — routing the value through `Number` to
 * validate it would reintroduce exactly the precision loss the string avoids.
 */
export function assertValidAmount(amount: string): void {
  if (typeof amount !== 'string' || !AMOUNT_PATTERN.test(amount)) {
    throw new ChainError(
      `Invalid amount "${amount}": expected a positive decimal string with at most 7 decimal places.`,
    );
  }

  if (/^0(\.0{1,7})?$/.test(amount)) {
    throw new ChainError('Amount must be greater than zero.');
  }
}
