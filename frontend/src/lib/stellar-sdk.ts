/**
 * Level 1 — Stellar SDK layer (Requirements 3 & 4).
 *
 * Balance reads and payment-transaction building/submission against Horizon
 * TESTNET, using `@stellar/stellar-sdk` explicitly. Pairs with `stellar-wallet.ts`
 * (Freighter signing) to complete the send flow on the `/wallet` demo page.
 */
import {
  Asset,
  BASE_FEE,
  Horizon,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { HORIZON_TESTNET_URL } from './stellar-wallet';

const server = new Horizon.Server(HORIZON_TESTNET_URL);

/**
 * Requirement 3 — fetch the account's native XLM balance from Horizon.
 * Returns the raw string balance (e.g. "12.5000000"). An unfunded account
 * (HTTP 404) is not an error here — it resolves to "0".
 */
export async function fetchXlmBalance(address: string): Promise<string> {
  try {
    const account = await server.loadAccount(address);
    const native = account.balances.find((b) => b.asset_type === 'native');
    return native?.balance ?? '0';
  } catch (err: unknown) {
    // Horizon returns 404 for accounts that have never been funded.
    if (isNotFound(err)) return '0';
    throw new Error(horizonMessage(err, 'Failed to fetch balance from Horizon.'));
  }
}

/**
 * Requirement 4 (steps 1–3) — load the source account, build a native-XLM
 * payment transaction, and return it as an unsigned XDR string.
 */
export async function buildPaymentXdr(
  from: string,
  to: string,
  amount: string,
): Promise<string> {
  try {
    const account = await server.loadAccount(from);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: to,
          asset: Asset.native(),
          amount,
        }),
      )
      .setTimeout(30)
      .build();

    return transaction.toXDR();
  } catch (err: unknown) {
    if (isNotFound(err)) {
      throw new Error('Source account not found on testnet — fund it first.');
    }
    throw new Error(horizonMessage(err, 'Failed to build the payment transaction.'));
  }
}

/**
 * Requirement 4 (step 5) — rehydrate a signed XDR and submit it to Horizon.
 * Resolves with the transaction hash on success; rejects with the Horizon
 * error message on failure.
 */
export async function submitSignedTx(signedXdr: string): Promise<{ hash: string }> {
  try {
    const transaction = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    const result = await server.submitTransaction(transaction);
    return { hash: result.hash };
  } catch (err: unknown) {
    throw new Error(horizonMessage(err, 'Horizon rejected the transaction.'));
  }
}

/** True when the error is a Horizon 404 (account not found). */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    (err as { response?: { status?: number } }).response?.status === 404
  );
}

/**
 * Extracts the most specific message from a Horizon SDK error, preferring the
 * `result_codes` returned in `extras` (e.g. "op_underfunded") over the generic
 * HTTP title.
 */
function horizonMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const data = (err as { response?: { data?: HorizonErrorData } }).response?.data;
    const codes = data?.extras?.result_codes;
    if (codes) {
      const parts = [codes.transaction, ...(codes.operations ?? [])].filter(Boolean);
      if (parts.length) return `Transaction failed: ${parts.join(', ')}`;
    }
    if (data?.detail) return data.detail;
    if (data?.title) return data.title;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

interface HorizonErrorData {
  title?: string;
  detail?: string;
  extras?: {
    result_codes?: {
      transaction?: string;
      operations?: string[];
    };
  };
}
