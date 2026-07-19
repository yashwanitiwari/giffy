import { Asset, Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import { accountExists, assertValidPublicKey, hasTrustline, loadAccount } from '../src/accounts.js';
import { AccountNotFoundError, ChainError } from '../src/errors.js';
import { fundedKeypair } from './helpers.js';

describe('accounts (live testnet)', () => {
  it('loads a funded account with a usable sequence number', async () => {
    const keypair = await fundedKeypair();

    const account = await loadAccount(keypair.publicKey());

    expect(account.accountId()).toBe(keypair.publicKey());
    expect(BigInt(account.sequenceNumber())).toBeGreaterThan(0n);
  });

  it('advances the sequence number as the ledger moves, rather than serving a cached one', async () => {
    // Sequence numbers must be read fresh immediately before building, or a
    // transaction fails at submit time with tx_bad_seq — after the user has
    // already approved the signature.
    const keypair = await fundedKeypair();

    const first = await loadAccount(keypair.publicKey());
    const second = await loadAccount(keypair.publicKey());

    expect(second.sequenceNumber()).toBe(first.sequenceNumber());
    expect(second).not.toBe(first); // a fresh fetch, not a memoized instance
  });

  it('throws a typed error for an account that does not exist', async () => {
    const unfunded = Keypair.random().publicKey();

    await expect(loadAccount(unfunded)).rejects.toBeInstanceOf(AccountNotFoundError);
  });

  it('reports whether an account exists', async () => {
    const funded = await fundedKeypair();

    expect(await accountExists(funded.publicKey())).toBe(true);
    expect(await accountExists(Keypair.random().publicKey())).toBe(false);
  });

  it('reports a native trustline as always present', async () => {
    const keypair = await fundedKeypair();

    expect(await hasTrustline(keypair.publicKey(), Asset.native())).toBe(true);
  });

  it('reports no trustline for an issued asset on a fresh account', async () => {
    const keypair = await fundedKeypair();
    const asset = new Asset('SRT', 'GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B');

    expect(await hasTrustline(keypair.publicKey(), asset)).toBe(false);
  });

  it('rejects a malformed address without making a network call', async () => {
    await expect(accountExists('not-an-address')).rejects.toBeInstanceOf(ChainError);
    expect(() => assertValidPublicKey('GDQK2MW24YTQO6QCP2JXWXLCDNLNQMDRZQHTAFNCAQ7JCZK64Q7MPED')).toThrow(
      ChainError,
    );
  });
});
