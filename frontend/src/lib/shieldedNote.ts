/**
 * Shielded-note management for sealed (confidential-amount) gifts.
 *
 * A sealed gift is a secret *note* the sender deposits into the pool; the claim
 * link carries that secret and nothing else on-chain reveals the amount. This
 * module owns note secrets and the claim-link encoding. The secret is the whole
 * bearer credential — whoever holds the link can withdraw — exactly like the
 * existing claim token, but here it also unlocks the ZK proof.
 */

import { noteCommitment } from '@/lib/zkProver';

/** The BLS12-381 scalar field modulus (r). Secrets must be reduced below it. */
const FR_MODULUS = BigInt(
  '0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001',
);

function toHex32(v: bigint): string {
  return v.toString(16).padStart(64, '0');
}

/** A freshly minted sealed-gift note. */
export interface ShieldedNote {
  /** 32-byte hex secret (< r). The bearer credential. */
  secretHex: string;
  /** `Poseidon2(secret, 0)` — the commitment deposited on-chain. */
  commitmentHex: string;
}

/**
 * Generate a new note: 256 bits of CSPRNG entropy reduced into the scalar field,
 * plus its commitment (computed in-browser via the wasm Poseidon2).
 */
export async function generateNote(): Promise<ShieldedNote> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let v = 0n;
  for (const b of buf) v = (v << 8n) | BigInt(b);
  const secret = v % FR_MODULUS;
  const secretHex = toHex32(secret);
  const commitmentHex = await noteCommitment(secretHex);
  return { secretHex, commitmentHex };
}

/**
 * Encode a claim link for a sealed gift. The secret lives only in the URL
 * fragment (`#`), which browsers never send to the server — so even the Giffy
 * backend never sees it. `origin` is e.g. `https://giffy.app`.
 */
export function encodeSealedClaimLink(origin: string, secretHex: string): string {
  return `${origin}/claim/sealed#s=${secretHex}`;
}

/** Extract a note secret from a sealed claim link's fragment, or null. */
export function decodeSealedClaimSecret(hash: string): string | null {
  const m = /[#&]s=([0-9a-fA-F]{64})/.exec(hash);
  return m ? m[1].toLowerCase() : null;
}
