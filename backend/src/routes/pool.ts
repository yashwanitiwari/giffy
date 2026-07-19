import { Router } from 'express';
import { z } from 'zod';
import { isShieldedPoolConfigured, shieldedPoolContractId } from '@giffy/chain';

import { getOrderedCommitments } from '../services/poolIndexerService.js';
import { buildDeposit, buildWithdraw, submitPoolTx } from '../services/poolService.js';

const hex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`), `expected ${bytes}-byte hex`);
const pubkey = z.string().regex(/^G[A-Z2-7]{55}$/, 'invalid Stellar public key');

const depositSchema = z.object({ fromPublicKey: pubkey, commitment: hex(32) }).strict();
const withdrawSchema = z
  .object({
    sourcePublicKey: pubkey,
    root: hex(32),
    nullifier: hex(32),
    recipient: pubkey,
    recipientSignal: hex(32),
    proof: z.object({ a: hex(96), b: hex(192), c: hex(96) }).strict(),
  })
  .strict();
const submitSchema = z.object({ signedXdr: z.string().min(1), kind: z.enum(['deposit', 'withdraw']) }).strict();

function ensureEnabled(res: import('express').Response): boolean {
  if (!isShieldedPoolConfigured()) {
    res.status(404).json({ error: { code: 'POOL_DISABLED', message: 'Sealed gifts are not enabled.' } });
    return false;
  }
  return true;
}

/**
 * Confidential-pool read routes (sealed-gift flow).
 *
 * Public and unauthenticated: the commitment list is already public on-chain
 * (it is the pool's Merkle tree), and a recipient needs it to rebuild their
 * note's authentication path in the browser before proving a withdrawal.
 */
export const poolRoutes = Router();

/** Pool parameters the frontend needs to deposit/withdraw against. */
poolRoutes.get('/info', (_req, res) => {
  if (!isShieldedPoolConfigured()) {
    res.status(404).json({ error: { code: 'POOL_DISABLED', message: 'Sealed gifts are not enabled.' } });
    return;
  }
  res.json({
    poolId: shieldedPoolContractId(),
    depth: 8,
  });
});

/**
 * The ordered note commitments — everything the browser needs to reconstruct the
 * Merkle tree. Returns 409 if the indexer has a gap (it must catch up first).
 */
poolRoutes.get('/leaves', async (_req, res, next) => {
  try {
    if (!isShieldedPoolConfigured()) {
      res.status(404).json({ error: { code: 'POOL_DISABLED', message: 'Sealed gifts are not enabled.' } });
      return;
    }
    const { commitments, count } = await getOrderedCommitments(shieldedPoolContractId());
    res.json({ poolId: shieldedPoolContractId(), count, commitments });
  } catch (err) {
    if (err instanceof Error && err.message.includes('gap')) {
      res.status(409).json({ error: { code: 'INDEXER_BEHIND', message: err.message } });
      return;
    }
    next(err);
  }
});

/** Build the `deposit` transaction (sender locks the denomination + inserts a note). */
poolRoutes.post('/deposit/build-transaction', async (req, res, next) => {
  if (!ensureEnabled(res)) return;
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION', issues: parsed.error.issues } });
    return;
  }
  try {
    res.json(await buildDeposit(parsed.data.fromPublicKey, parsed.data.commitment));
  } catch (err) {
    next(err);
  }
});

/** Build the `withdraw` transaction from a browser-generated proof. */
poolRoutes.post('/withdraw/build-transaction', async (req, res, next) => {
  if (!ensureEnabled(res)) return;
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION', issues: parsed.error.issues } });
    return;
  }
  try {
    const d = parsed.data;
    res.json(
      await buildWithdraw({
        sourcePublicKey: d.sourcePublicKey,
        rootHex: d.root,
        nullifierHex: d.nullifier,
        recipientPublicKey: d.recipient,
        recipientSignalHex: d.recipientSignal,
        proof: d.proof,
      }),
    );
  } catch (err) {
    next(err);
  }
});

/** Submit a signed deposit/withdraw transaction. */
poolRoutes.post('/submit', async (req, res, next) => {
  if (!ensureEnabled(res)) return;
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION', issues: parsed.error.issues } });
    return;
  }
  try {
    res.json(await submitPoolTx(parsed.data.signedXdr, parsed.data.kind));
  } catch (err) {
    next(err);
  }
});
