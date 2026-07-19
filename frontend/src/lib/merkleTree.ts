/**
 * Client-side reconstruction of the shielded pool's Merkle tree.
 *
 * The pool inserts note commitments left-to-right into a fixed-depth incremental
 * tree (see `contracts/shielded-pool/src/lib.rs`). To withdraw, the recipient
 * needs their note's *authentication path* — the sibling at each level and
 * whether the node is a left/right child. The deposit indexer serves the ordered
 * list of every commitment; this module rebuilds the tree from it (using the same
 * Poseidon2 as the contract, via wasm) and extracts one leaf's path.
 *
 * The "zeros" (empty-subtree hashes) must match the contract's:
 *   zeros[0] = 0, zeros[i+1] = Poseidon2(zeros[i], zeros[i]).
 */

import initWasm, { poseidon_hash2_hex } from '@/wasm/zkprover/zk_prover_wasm';
import { POOL_DEPTH } from '@/lib/zkProver';

const ZERO_HEX = '0'.repeat(64);

let wasmReady: Promise<void> | null = null;
async function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initWasm({ module_or_path: '/zk/zk_prover_wasm_bg.wasm' }).then(() => undefined);
  }
  await wasmReady;
}

export interface MerklePath {
  /** DEPTH sibling hashes, leaf→root. */
  siblingsHex: string[];
  /** DEPTH position bits, leaf→root; true = the node is a right child. */
  indexBits: boolean[];
  /** The resulting root — must equal the on-chain root the proof is checked against. */
  rootHex: string;
}

/** Precompute the per-level empty-subtree hashes. */
async function computeZeros(): Promise<string[]> {
  await ensureWasm();
  const zeros = [ZERO_HEX];
  for (let i = 0; i < POOL_DEPTH; i += 1) {
    zeros.push(poseidon_hash2_hex(zeros[i], zeros[i]));
  }
  return zeros;
}

/**
 * Rebuild the tree from the ordered commitment list and return the auth path for
 * the leaf at `leafIndex`. `leaves[i]` is the commitment deposited at index `i`;
 * positions beyond the list are empty (zeros).
 */
export async function buildAuthPath(leaves: string[], leafIndex: number): Promise<MerklePath> {
  await ensureWasm();
  const zeros = await computeZeros();

  // Level 0: the full row of 2^DEPTH leaves, padding empties with zeros[0].
  const width = 1 << POOL_DEPTH;
  let level: string[] = new Array(width);
  for (let i = 0; i < width; i += 1) level[i] = i < leaves.length ? leaves[i] : ZERO_HEX;

  const siblingsHex: string[] = [];
  const indexBits: boolean[] = [];
  let pos = leafIndex;

  for (let d = 0; d < POOL_DEPTH; d += 1) {
    const siblingPos = pos ^ 1;
    siblingsHex.push(siblingPos < level.length ? level[siblingPos] : zeros[d]);
    indexBits.push((pos & 1) === 1);

    const next: string[] = new Array(level.length >> 1);
    for (let j = 0; j < level.length; j += 2) {
      next[j >> 1] = poseidon_hash2_hex(level[j], level[j + 1]);
    }
    level = next;
    pos >>= 1;
  }

  return { siblingsHex, indexBits, rootHex: level[0] };
}
