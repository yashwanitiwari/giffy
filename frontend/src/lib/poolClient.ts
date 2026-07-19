/**
 * Client orchestration for the confidential gift pool (sealed-gift flow).
 *
 * Ties the three proven pieces together:
 *   deposit indexer (backend `/api/pool/leaves`) → Merkle path (`merkleTree`)
 *   → withdraw proof (`zkProver`, wasm).
 *
 * The result is everything the pool contract's `withdraw` needs. This module
 * does no signing or submission — that's the wallet/tx layer — it produces the
 * proof + public signals a withdraw transaction is built from.
 */

import { StrKey } from '@stellar/stellar-sdk';

import { buildAuthPath } from '@/lib/merkleTree';
import { generateNote, type ShieldedNote } from '@/lib/shieldedNote';
import { noteCommitment, proveWithdraw, type WithdrawProof } from '@/lib/zkProver';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

/** BLS12-381 scalar field modulus (r) — the recipient field must be < r. */
const FR_MODULUS = BigInt(
  '0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001',
);

/**
 * Derive the recipient binding field from a Stellar public key: `SHA-256(pubkey)
 * mod r`. The withdraw proof commits to this value and the pool pays the matching
 * address, so a valid proof can't be re-pointed at another wallet. (Slice-grade:
 * the contract does not yet re-derive this in-contract — see shielded-pool README.)
 */
export async function recipientFieldFromPublicKey(publicKey: string): Promise<string> {
  const raw = StrKey.decodeEd25519PublicKey(publicKey);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  let v = 0n;
  for (const b of digest) v = (v << 8n) | BigInt(b);
  return (v % FR_MODULUS).toString(16).padStart(64, '0');
}

export interface PoolInfo {
  poolId: string;
  depth: number;
}

export interface PoolLeaves {
  poolId: string;
  count: number;
  /** Ordered note commitments, index 0..count-1. */
  commitments: string[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (res.status === 404) throw new Error('Sealed gifts are not enabled on this server.');
  if (res.status === 409) throw new Error('The deposit indexer is catching up — try again shortly.');
  if (!res.ok) throw new Error(`Pool request failed (${res.status}).`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error?.message ?? `Pool request failed (${res.status}).`);
  }
  return (await res.json()) as T;
}

export const getPoolInfo = () => getJson<PoolInfo>('/pool/info');
export const getPoolLeaves = () => getJson<PoolLeaves>('/pool/leaves');

export interface BuiltTx {
  xdr: string;
  networkPassphrase: string;
}

/** Build the deposit transaction (sender locks the denomination + inserts the note). */
export const buildDepositTx = (fromPublicKey: string, commitment: string) =>
  postJson<BuiltTx>('/pool/deposit/build-transaction', { fromPublicKey, commitment });

/** Build the withdraw transaction from a browser-generated proof. */
export const buildWithdrawTx = (params: {
  sourcePublicKey: string;
  root: string;
  nullifier: string;
  recipient: string;
  recipientSignal: string;
  proof: { a: string; b: string; c: string };
}) => postJson<BuiltTx>('/pool/withdraw/build-transaction', params);

/** Submit a signed deposit/withdraw transaction. */
export const submitPoolTx = (signedXdr: string, kind: 'deposit' | 'withdraw') =>
  postJson<{ status: string; txHash: string }>('/pool/submit', { signedXdr, kind });

/** Mint a fresh sealed-gift note for the sender to deposit. */
export async function prepareDeposit(): Promise<ShieldedNote> {
  return generateNote();
}

/**
 * Prepare a withdrawal: from a note secret and the recipient binding, fetch the
 * pool's leaves, locate this note, rebuild its Merkle path, and generate the
 * proof. Throws a clear error if the note isn't in the pool yet (deposit not
 * indexed).
 */
export async function prepareWithdraw(
  secretHex: string,
  recipientHex: string,
): Promise<WithdrawProof & { leafIndex: number }> {
  const commitment = await noteCommitment(secretHex);
  const { commitments } = await getPoolLeaves();

  const leafIndex = commitments.findIndex((c) => c.toLowerCase() === commitment.toLowerCase());
  if (leafIndex < 0) {
    throw new Error('This gift has not been deposited (or indexed) yet.');
  }

  const path = await buildAuthPath(commitments, leafIndex);
  const proof = await proveWithdraw({
    secretHex,
    siblingsHex: path.siblingsHex,
    indexBits: path.indexBits,
    recipientHex,
  });

  // The proof's root must match the freshly reconstructed root — a sanity check
  // that the indexer's view and the prover's computation agree.
  if (proof.root.toLowerCase() !== path.rootHex.toLowerCase()) {
    throw new Error('Internal error: reconstructed root and proof root disagree.');
  }

  return { ...proof, leafIndex };
}
