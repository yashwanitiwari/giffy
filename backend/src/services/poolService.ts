import {
  buildPoolDepositTx,
  buildPoolWithdrawTx,
  networkPassphrase,
  submitSignedInvocation,
  type WithdrawProofInput,
} from '@giffy/chain';

import { syncPoolDeposits } from './poolIndexerService.js';

/**
 * Build/submit orchestration for the confidential pool (sealed-gift flow),
 * mirroring `giftService`'s build-transaction → sign → submit shape: the backend
 * builds and simulates (resolving the Soroban auth tree, including the nested
 *
 * KNOWN ISSUE (cosmetic): contract errors from the pool are currently mapped
 * through the chain layer's `parseContractError`, which uses the gift-escrow
 * error table — so a pool `NotInitialized`/`NullifierUsed` surfaces with an
 * escrow message ("This gift is no longer open"). A pool-specific error table
 * should be added before launch; the codes themselves are still distinct.
 *
 * token transfer), the client signs with Freighter, and submits back here.
 */

export interface BuiltTx {
  xdr: string;
  networkPassphrase: string;
}

export async function buildDeposit(fromPublicKey: string, commitmentHex: string): Promise<BuiltTx> {
  const xdr = await buildPoolDepositTx({ fromPublicKey, commitmentHex });
  return { xdr, networkPassphrase };
}

export async function buildWithdraw(params: {
  sourcePublicKey: string;
  rootHex: string;
  nullifierHex: string;
  recipientPublicKey: string;
  recipientSignalHex: string;
  proof: WithdrawProofInput;
}): Promise<BuiltTx> {
  const xdr = await buildPoolWithdrawTx(params);
  return { xdr, networkPassphrase };
}

/**
 * Submit a signed pool transaction. After a successful deposit we kick an
 * indexer sync so the new leaf is servable without waiting for the next cron
 * tick — a recipient told "your gift is ready" should find it immediately.
 */
export async function submitPoolTx(
  signedXdr: string,
  kind: 'deposit' | 'withdraw',
): Promise<{ status: string; txHash: string }> {
  const result = await submitSignedInvocation(signedXdr);
  if (kind === 'deposit') {
    void syncPoolDeposits().catch(() => undefined);
  }
  return { status: result.status, txHash: result.txHash };
}
