import { describe, expect, it } from 'vitest';

import {
  assertValidAmount,
  describeAsset,
  KNOWN_TESTNET_ASSETS,
  resolveAsset,
} from '../src/assets.js';
import { ChainError } from '../src/errors.js';

const ISSUER = 'GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B';

describe('resolveAsset', () => {
  it('resolves XLM to the native asset', () => {
    const asset = resolveAsset('XLM');

    expect(asset.isNative()).toBe(true);
  });

  it('resolves an explicit issuer', () => {
    const asset = resolveAsset('USDC', ISSUER);

    expect(asset.getCode()).toBe('USDC');
    expect(asset.getIssuer()).toBe(ISSUER);
  });

  it('falls back to a known testnet issuer when none is given', () => {
    const asset = resolveAsset('SRT');

    expect(asset.getIssuer()).toBe(KNOWN_TESTNET_ASSETS.SRT!.issuer);
  });

  it('prefers an explicitly supplied issuer over the known default', () => {
    // The anchor's toml is authoritative at runtime; a caller passing an issuer is
    // relaying what the toml said and must not be silently overridden by our
    // hardcoded fallback.
    const other = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    expect(resolveAsset('SRT', other).getIssuer()).toBe(other);
  });

  it('refuses an unknown asset with no issuer rather than guessing one', () => {
    // Guessing would risk locking funds into an entirely different asset.
    expect(() => resolveAsset('WAT')).toThrow(ChainError);
  });

  it('rejects a malformed issuer', () => {
    expect(() => resolveAsset('USDC', 'not-an-address')).toThrow(ChainError);
  });

  it('rejects an issuer on native XLM', () => {
    expect(() => resolveAsset('XLM', ISSUER)).toThrow(ChainError);
  });

  it('rejects an empty code', () => {
    expect(() => resolveAsset('')).toThrow(ChainError);
  });
});

describe('describeAsset', () => {
  it('round-trips a native asset', () => {
    expect(describeAsset(resolveAsset('XLM'))).toEqual({ code: 'XLM', issuer: null });
  });

  it('round-trips an issued asset', () => {
    expect(describeAsset(resolveAsset('SRT', ISSUER))).toEqual({ code: 'SRT', issuer: ISSUER });
  });
});

describe('assertValidAmount', () => {
  it.each(['1', '0.0000001', '5.0000000', '12.5', '9999999999.9999999'])(
    'accepts %s',
    (amount) => {
      expect(() => assertValidAmount(amount)).not.toThrow();
    },
  );

  it('rejects more than 7 decimal places, which Stellar cannot represent', () => {
    expect(() => assertValidAmount('1.00000001')).toThrow(ChainError);
  });

  it.each([
    ['zero', '0'],
    ['zero with decimals', '0.0000000'],
    ['negative', '-5'],
    ['empty', ''],
    ['not a number', 'abc'],
    ['scientific notation', '1e5'],
    ['comma separated', '1,000'],
    ['leading plus', '+5'],
    ['whitespace', ' 5 '],
  ])('rejects %s', (_label, amount) => {
    expect(() => assertValidAmount(amount)).toThrow(ChainError);
  });

  it('rejects a number, since amounts must stay strings end-to-end', () => {
    // README §12.4: passing a float here is the bug this guard exists to catch.
    expect(() => assertValidAmount(5 as unknown as string)).toThrow(ChainError);
  });
});
