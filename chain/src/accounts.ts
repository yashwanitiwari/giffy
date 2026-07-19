import { StrKey, type Asset, type TransactionSource } from '@stellar/stellar-sdk';

import { AccountNotFoundError, ChainError, parseHorizonError } from './errors.js';
import { horizon } from './horizonClient.js';

/** Throws unless `publicKey` is a well-formed `G...` StrKey address. */
export function assertValidPublicKey(publicKey: string, label = 'public key'): void {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new ChainError(`Invalid ${label}: not a well-formed Stellar address.`);
  }
}

function isNotFound(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 404;
}

/**
 * Loads an account, including its current sequence number.
 *
 * Always call this immediately before building a transaction rather than caching
 * the result — a stale sequence number produces a `tx_bad_seq` rejection at submit
 * time, long after the user has already approved the signature.
 */
export async function loadAccount(publicKey: string): Promise<TransactionSource> {
  assertValidPublicKey(publicKey);

  try {
    return await horizon.loadAccount(publicKey);
  } catch (err) {
    if (isNotFound(err)) {
      throw new AccountNotFoundError(
        'This Stellar account does not exist yet. It must be funded before it can transact.',
        err,
      );
    }
    throw parseHorizonError(err);
  }
}

export async function accountExists(publicKey: string): Promise<boolean> {
  assertValidPublicKey(publicKey);

  try {
    await horizon.loadAccount(publicKey);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw parseHorizonError(err);
  }
}

/**
 * Whether `publicKey` can currently hold `asset`.
 *
 * Native XLM needs no trustline, so this is vacuously true for it. A non-existent
 * account trivially has no trustlines, and is reported as `false` rather than
 * throwing — callers asking this question want a yes/no to gate a ChangeTrustOp.
 */
export async function hasTrustline(publicKey: string, asset: Asset): Promise<boolean> {
  assertValidPublicKey(publicKey);

  if (asset.isNative()) return true;

  let account: TransactionSource & { balances?: unknown };
  try {
    account = await horizon.loadAccount(publicKey);
  } catch (err) {
    if (isNotFound(err)) return false;
    throw parseHorizonError(err);
  }

  const balances = (account as unknown as {
    balances: { asset_type: string; asset_code?: string; asset_issuer?: string }[];
  }).balances;

  return balances.some(
    (balance) =>
      balance.asset_type !== 'native' &&
      balance.asset_code === asset.getCode() &&
      balance.asset_issuer === asset.getIssuer(),
  );
}
