import { Keypair, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';

import { config } from '../src/config.js';
import { networkPassphrase } from '../src/horizonClient.js';

/**
 * Integration-test helpers.
 *
 * Accounts are funded fresh via Friendbot at run time rather than kept as fixture
 * keypairs (README §18.3) — testnet resets periodically, and a hardcoded account
 * would silently go stale and start failing for reasons unrelated to the code.
 *
 * The keypairs here are throwaway testnet accounts generated per run. This is the
 * one place in the repo that signs anything, and it exists only because a test has
 * no Freighter to sign for it; nothing under src/ ever touches a secret key.
 */

const FRIENDBOT_URL = 'https://friendbot.stellar.org';

export async function fundedKeypair(): Promise<Keypair> {
  const keypair = Keypair.random();

  const response = await fetch(`${FRIENDBOT_URL}?addr=${keypair.publicKey()}`);

  if (!response.ok) {
    throw new Error(
      `Friendbot could not fund ${keypair.publicKey()} (HTTP ${response.status}). ` +
        'Testnet may be resetting; retry in a few minutes.',
    );
  }

  return keypair;
}

/** Stands in for Freighter: signs unsigned XDR and returns the signed envelope. */
export function signXdr(unsignedXdr: string, keypair: Keypair): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase) as Transaction;
  tx.sign(keypair);
  return tx.toXDR();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function nativeBalanceOf(publicKey: string): Promise<number> {
  const response = await fetch(`${config.HORIZON_URL}/accounts/${publicKey}`);
  const account = (await response.json()) as {
    balances: { asset_type: string; balance: string }[];
  };

  const native = account.balances.find((balance) => balance.asset_type === 'native');
  return Number(native?.balance ?? '0');
}

export async function assetBalanceOf(
  publicKey: string,
  code: string,
  issuer: string,
): Promise<string | null> {
  const response = await fetch(`${config.HORIZON_URL}/accounts/${publicKey}`);
  const account = (await response.json()) as {
    balances: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }[];
  };

  const match = account.balances.find(
    (balance) => balance.asset_code === code && balance.asset_issuer === issuer,
  );

  return match?.balance ?? null;
}
