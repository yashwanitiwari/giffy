import { Asset, Keypair, Operation, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadAccount } from '../src/accounts.js';
import { BASE_FEE_STROOPS } from '../src/config.js';
import { horizon, networkPassphrase } from '../src/horizonClient.js';
import { buildChangeTrustTx, hasTrustline, needsTrustline } from '../src/trustline.js';
import { assetBalanceOf, fundedKeypair, signXdr } from './helpers.js';

/**
 * `trustline.ts` is the one file in `/chain` that still talks to classic
 * Horizon rather than Soroban RPC (README §11.4) — this exercises that
 * against live testnet, independent of the `gift-escrow` contract itself,
 * since trustline setup is now always its own separate transaction rather
 * than something batchable into a `create_gift`/`contribute`/`claim`
 * invocation (README §6).
 */
describe('classic trustline management (live testnet)', () => {
  let issuer: Keypair;
  let holder: Keypair;
  let asset: Asset;

  beforeAll(async () => {
    [issuer, holder] = await Promise.all([fundedKeypair(), fundedKeypair()]);
    asset = new Asset('GIFT', issuer.publicKey());
  });

  it('reports no trustline requirement for native XLM', async () => {
    expect(await needsTrustline(holder.publicKey(), Asset.native())).toBe(false);
    expect(await hasTrustline(holder.publicKey(), Asset.native())).toBe(true);
  });

  it('reports a trustline requirement for an account that has never held the asset', async () => {
    expect(await needsTrustline(holder.publicKey(), asset)).toBe(true);
    expect(await hasTrustline(holder.publicKey(), asset)).toBe(false);
  });

  it('reports a trustline requirement for an account that does not exist at all', async () => {
    const unfunded = Keypair.random().publicKey();

    expect(await needsTrustline(unfunded, asset)).toBe(true);
  });

  it('builds a signable ChangeTrustOp transaction that establishes a trustline end to end', async () => {
    const xdr = await buildChangeTrustTx({ publicKey: holder.publicKey(), asset });

    const decoded = TransactionBuilder.fromXDR(xdr, networkPassphrase) as Transaction;
    expect(decoded.operations).toHaveLength(1);
    expect(decoded.operations[0]?.type).toBe('changeTrust');

    const signed = signXdr(xdr, holder);
    const signedTx = TransactionBuilder.fromXDR(signed, networkPassphrase) as Transaction;

    // Submitting is ordinary Horizon plumbing at this point, not the code
    // under test — confirm the built XDR is actually acceptable to the
    // network, then confirm the trustline really landed.
    await horizon.submitTransaction(signedTx);

    expect(await hasTrustline(holder.publicKey(), asset)).toBe(true);
    expect(await needsTrustline(holder.publicKey(), asset)).toBe(false);
  });

  it('lets the issuer pay into the freshly opened trustline', async () => {
    const issuerAccount = await loadAccount(issuer.publicKey());
    const payTx = new TransactionBuilder(issuerAccount, {
      fee: BASE_FEE_STROOPS,
      networkPassphrase,
    })
      .addOperation(Operation.payment({ destination: holder.publicKey(), asset, amount: '5.0000000' }))
      .setTimeout(60)
      .build();
    payTx.sign(issuer);

    await horizon.submitTransaction(payTx);

    expect(await assetBalanceOf(holder.publicKey(), 'GIFT', issuer.publicKey())).toBe('5.0000000');
  });
});
