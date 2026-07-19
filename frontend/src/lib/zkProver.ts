/**
 * Browser-side ZK prover for sealed (confidential-amount) gifts.
 *
 * Wraps the wasm module compiled from `zk-prover-wasm` (which itself wraps the
 * `zk-circuits` withdraw circuit). Everything here runs client-side — the note
 * secret never touches the network. Measured cost: ~770 KB proving key (fetched
 * once, then cached), ~470 KB wasm, ~3 s to prove. The prover and key are loaded
 * lazily so the normal (unsealed) gift flow pays none of that.
 *
 * ⚠️ The proving key served from `/zk/pk.bin` comes from a test-grade trusted
 * setup and must match the verifying key the pool contract was initialized with.
 * Production needs a real setup ceremony (see zk-prover-wasm/README.md).
 */

import initWasm, {
  note_commitment_hex,
  prove_withdraw_js,
} from '@/wasm/zkprover/zk_prover_wasm';

let wasmReady: Promise<void> | null = null;
let pkBytes: Uint8Array | null = null;

/** Depth of the pool's Merkle tree — must match the contract's `DEPTH`. */
export const POOL_DEPTH = 8;

async function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    // Init from an explicit public URL rather than the bundler-resolved asset
    // path — keeps this working the same under webpack, Turbopack, and export.
    wasmReady = initWasm({ module_or_path: '/zk/zk_prover_wasm_bg.wasm' }).then(() => undefined);
  }
  await wasmReady;
}

async function ensureProvingKey(): Promise<Uint8Array> {
  if (!pkBytes) {
    const res = await fetch('/zk/pk.bin');
    if (!res.ok) throw new Error(`Could not load proving key (${res.status}).`);
    pkBytes = new Uint8Array(await res.arrayBuffer());
  }
  return pkBytes;
}

/**
 * The note commitment (Merkle leaf) for a secret: `Poseidon2(secret, 0)`, as a
 * 32-byte hex string. This is what the sender deposits into the pool. Cheap —
 * loads only the wasm, not the proving key.
 */
export async function noteCommitment(secretHex: string): Promise<string> {
  await ensureWasm();
  return note_commitment_hex(secretHex);
}

export interface WithdrawPathInput {
  /** The note secret (from the claim link). */
  secretHex: string;
  /** DEPTH sibling hashes (leaf→root), from the deposit indexer. */
  siblingsHex: string[];
  /** DEPTH position bits (leaf→root); true = note is the right child. */
  indexBits: boolean[];
  /** Field the payout is bound to (derived from the recipient). */
  recipientHex: string;
}

export interface WithdrawProof {
  /** Uncompressed G1/G2 hex, ready for the pool's `Proof` type. */
  a: string;
  b: string;
  c: string;
  /** Public signals the contract re-checks. */
  root: string;
  nullifier: string;
}

/**
 * Generate a withdraw proof in the browser (~3 s). Loads the proving key on
 * first use. Returns the proof in the pool contract's uncompressed format plus
 * the public `root` and `nullifier`.
 */
export async function proveWithdraw(input: WithdrawPathInput): Promise<WithdrawProof> {
  if (input.siblingsHex.length !== POOL_DEPTH || input.indexBits.length !== POOL_DEPTH) {
    throw new Error(`Merkle path must have exactly ${POOL_DEPTH} levels.`);
  }
  await ensureWasm();
  const pk = await ensureProvingKey();
  const json = prove_withdraw_js(
    pk,
    input.secretHex,
    input.siblingsHex.join('\n'),
    input.indexBits.map((b) => (b ? '1' : '0')).join(''),
    input.recipientHex,
  );
  return JSON.parse(json) as WithdrawProof;
}
