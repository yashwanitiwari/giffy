/**
 * The assets a sender can gift, mirroring `chain/src/assets.ts`'s known testnet
 * issuers. The backend re-resolves and validates issuers independently — this list
 * only drives the asset picker UI.
 */

export interface GiftableAsset {
  code: string;
  issuer: string | null;
  label: string;
}

export const GIFTABLE_ASSETS: GiftableAsset[] = [
  { code: 'XLM', issuer: null, label: 'XLM · Stellar Lumens' },
  {
    code: 'USDC',
    issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    label: 'USDC · Testnet USD Coin',
  },
];

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

export interface AccountBalance {
  assetCode: string;
  balance: string;
}

/**
 * Read-only balance lookup straight from Horizon — display only; the ledger
 * re-validates spendability at submission regardless (§7.3 principle 3).
 */
export async function fetchBalances(publicKey: string): Promise<AccountBalance[]> {
  const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);

  // 404 means the account was never funded — an empty list, not an error.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Horizon lookup failed (${res.status}).`);

  const body = (await res.json()) as {
    balances: { asset_type: string; asset_code?: string; balance: string }[];
  };

  return body.balances.map((b) => ({
    assetCode: b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? '?'),
    balance: b.balance,
  }));
}
