/**
 * Client-side `ChangeTrustOp` handling (README §6 "The Trustline Tradeoff").
 *
 * Unlike every other state-changing action in this app, establishing a trustline
 * is a classic Stellar operation that never touches the `gift-escrow` contract and
 * therefore never needs Soroban simulation — the backend's REST surface (§15)
 * exposes no trustline endpoint at all. This module talks directly to Horizon,
 * mirroring the narrow classic-ledger exception documented for `chain/trustline.ts`
 * (§11.4), just built here in the frontend instead since there's no backend route
 * to proxy it through.
 */
import { Asset, BASE_FEE, Horizon, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

import { GIFTABLE_ASSETS } from './assets';

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;

const server = new Horizon.Server(HORIZON_URL);

/** Looks up the known issuer for a giftable asset code (null for native XLM). */
export function resolveAsset(assetCode: string): Asset {
  if (assetCode === 'XLM') return Asset.native();
  const known = GIFTABLE_ASSETS.find((a) => a.code === assetCode);
  if (!known?.issuer) throw new Error(`Unknown asset issuer for ${assetCode}.`);
  return new Asset(assetCode, known.issuer);
}

/** True when `publicKey`'s account already trusts `assetCode` (always true for XLM). */
export async function hasTrustline(publicKey: string, assetCode: string): Promise<boolean> {
  if (assetCode === 'XLM') return true;

  try {
    const account = await server.loadAccount(publicKey);
    return account.balances.some(
      (b) =>
        (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
        b.asset_code === assetCode,
    );
  } catch {
    // Unfunded/unknown account — treat as "no trustline yet".
    return false;
  }
}

/** Builds the one-time, unsigned `ChangeTrustOp` transaction described in §6.3. */
export async function buildChangeTrustXdr(publicKey: string, assetCode: string): Promise<{
  xdr: string;
  networkPassphrase: string;
}> {
  const asset = resolveAsset(assetCode);
  const account = await server.loadAccount(publicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(180)
    .build();

  return { xdr: tx.toXDR(), networkPassphrase: NETWORK_PASSPHRASE };
}

/** Submits the Freighter-signed trustline transaction directly to Horizon. */
export async function submitChangeTrustXdr(signedXdr: string): Promise<{ hash: string }> {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const result = await server.submitTransaction(tx);
  return { hash: result.hash };
}
