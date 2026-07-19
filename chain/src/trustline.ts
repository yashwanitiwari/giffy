import { Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Asset } from '@stellar/stellar-sdk';

import { assertValidPublicKey, hasTrustline as accountHasTrustline, loadAccount } from './accounts.js';
import { BASE_FEE_STROOPS, TRANSACTION_TIMEOUT_SECONDS } from './config.js';
import { ChainError } from './errors.js';
import { networkPassphrase } from './horizonClient.js';

/**
 * `trustline.ts` — still classic, by necessity (README §11.4).
 *
 * This is the one place in `/chain` that still talks to classic Horizon rather
 * than Soroban RPC: a Soroban transaction invokes exactly one contract
 * function, so there is no equivalent of batching a `ChangeTrustOp` into the
 * same transaction as a `create_gift`/`contribute`/`claim` call the way a
 * classic Claimable Balance transaction could (README §6). Every non-native
 * trustline setup is therefore its own separate, classic, single-operation
 * transaction.
 */

export interface BuildChangeTrustTxParams {
  publicKey: string;
  asset: Asset;
  /** Optional trust limit; omitted means the SDK's default (effectively unlimited). */
  limit?: string;
}

/**
 * Builds an unsigned `ChangeTrustOp` transaction authorizing `publicKey` to
 * hold `asset`.
 */
export async function buildChangeTrustTx(params: BuildChangeTrustTxParams): Promise<string> {
  assertValidPublicKey(params.publicKey);

  if (params.asset.isNative()) {
    throw new ChainError('Native XLM does not require a trustline.');
  }

  const account = await loadAccount(params.publicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE_STROOPS,
    networkPassphrase,
  })
    .addOperation(
      Operation.changeTrust({
        asset: params.asset,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
      }),
    )
    .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
    .build();

  return tx.toXDR();
}

/**
 * Whether `publicKey` can currently hold `asset` — a thin re-export of
 * `accounts.hasTrustline` under the name README §11.4 documents this module as
 * exposing, so callers needing only trustline concerns can import everything
 * they need from this one file.
 */
export async function hasTrustline(publicKey: string, asset: Asset): Promise<boolean> {
  return accountHasTrustline(publicKey, asset);
}

/** Whether `publicKey` must establish a trustline before it can hold `asset`. */
export async function needsTrustline(publicKey: string, asset: Asset): Promise<boolean> {
  return !(await hasTrustline(publicKey, asset));
}
