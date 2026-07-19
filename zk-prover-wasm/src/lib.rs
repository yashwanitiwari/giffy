//! Browser-side withdraw prover for ZK-sealed gifts.
//!
//! The note `secret` never leaves the client: the browser computes the note
//! commitment (Poseidon2), and — given the note's Merkle path (supplied by the
//! deposit indexer) — generates a Groth16 proof that is then handed to the pool
//! contract's `withdraw`. This crate wraps `zk-circuits` so that flow can run in
//! wasm, and (via the native test) measures the two numbers that decide the UX:
//! proving-key size and proving time.

use ark_bls12_381::{Bls12_381, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ec::AffineRepr;
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{Groth16, ProvingKey};
use ark_serialize::CanonicalDeserialize;
use ark_snark::SNARK;
use zk_circuits::{poseidon2::hash2, WithdrawCircuit, DEPTH};

/// Parse a 32-byte big-endian hex string into a field element.
fn fr_from_hex(s: &str) -> Fr {
    let s = s.trim_start_matches("0x");
    let mut bytes = [0u8; 32];
    let raw = hex_to_bytes(s);
    let start = 32 - raw.len();
    bytes[start..].copy_from_slice(&raw);
    Fr::from_be_bytes_mod_order(&bytes)
}

fn fr_to_hex(f: &Fr) -> String {
    let v = f.into_bigint().to_bytes_be();
    let mut b = [0u8; 32];
    b[32 - v.len()..].copy_from_slice(&v);
    to_hex(&b)
}

fn hex_to_bytes(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}
fn to_hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{:02x}", x));
    }
    s
}

/// The commitment (Merkle leaf) for a note secret: `Poseidon2(secret, 0)`.
pub fn note_commitment(secret: &Fr) -> Fr {
    hash2(*secret, Fr::from(0u64))
}

// ---- Soroban uncompressed serialization (what the pool contract expects) ----

fn fq_be(x: &Fq) -> [u8; 48] {
    let v = x.into_bigint().to_bytes_be();
    let mut out = [0u8; 48];
    out[48 - v.len()..].copy_from_slice(&v);
    out
}
fn g1_soroban_hex(p: &G1Affine) -> String {
    let (x, y) = p.xy().unwrap();
    let mut b = [0u8; 96];
    b[..48].copy_from_slice(&fq_be(&x));
    b[48..].copy_from_slice(&fq_be(&y));
    to_hex(&b)
}
fn g2_soroban_hex(p: &G2Affine) -> String {
    let (x, y): (&Fq2, &Fq2) = (&p.x, &p.y);
    let mut b = [0u8; 192];
    b[..48].copy_from_slice(&fq_be(&x.c1));
    b[48..96].copy_from_slice(&fq_be(&x.c0));
    b[96..144].copy_from_slice(&fq_be(&y.c1));
    b[144..].copy_from_slice(&fq_be(&y.c0));
    to_hex(&b)
}

/// Inputs the browser assembles before proving. `siblings`/`index_bits` come
/// from the deposit indexer; `secret` from the claim link; `recipient` is the
/// field the pool binds the payout to.
pub struct WithdrawInputs {
    pub secret: Fr,
    pub siblings: [Fr; DEPTH],
    pub index_bits: [bool; DEPTH],
    pub recipient: Fr,
}

/// A withdraw proof in the pool contract's format: uncompressed a/b/c hex plus
/// the public `root` and `nullifier` (also hex).
pub struct SorobanProof {
    pub a: String,
    pub b: String,
    pub c: String,
    pub root: String,
    pub nullifier: String,
}

/// Generate a withdraw proof and return it in the contract's uncompressed format.
pub fn prove_withdraw<R: rand::RngCore + rand::CryptoRng>(
    pk: &ProvingKey<Bls12_381>,
    inputs: WithdrawInputs,
    rng: &mut R,
) -> SorobanProof {
    let (circuit, root, nullifier) =
        WithdrawCircuit::assign(inputs.secret, inputs.siblings, inputs.index_bits, inputs.recipient);
    let proof = Groth16::<Bls12_381>::prove(pk, circuit, rng).unwrap();
    SorobanProof {
        a: g1_soroban_hex(&proof.a),
        b: g2_soroban_hex(&proof.b),
        c: g1_soroban_hex(&proof.c),
        root: fr_to_hex(&root),
        nullifier: fr_to_hex(&nullifier),
    }
}

/// Deserialize a proving key produced by the offline trusted setup.
pub fn load_pk(bytes: &[u8]) -> ProvingKey<Bls12_381> {
    ProvingKey::<Bls12_381>::deserialize_uncompressed_unchecked(bytes).unwrap()
}

// ---- wasm-bindgen surface ---------------------------------------------------

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;

    /// `Poseidon2(secret, 0)` as hex — the note commitment the sender publishes.
    #[wasm_bindgen]
    pub fn note_commitment_hex(secret_hex: &str) -> String {
        fr_to_hex(&note_commitment(&fr_from_hex(secret_hex)))
    }

    /// 2-to-1 Poseidon2 of two 32-byte hex field elements — the same hash the
    /// pool uses on-chain. Lets the indexer/browser rebuild the Merkle tree and
    /// extract a note's authentication path.
    #[wasm_bindgen]
    pub fn poseidon_hash2_hex(a_hex: &str, b_hex: &str) -> String {
        fr_to_hex(&hash2(fr_from_hex(a_hex), fr_from_hex(b_hex)))
    }

    /// Generate a withdraw proof in the browser.
    ///
    /// `siblings_hex` is a `\n`-joined list of DEPTH 32-byte hex siblings;
    /// `index_bits` is a DEPTH-length string of '0'/'1' (leaf→root). Returns a
    /// JSON string `{proof, root, nullifier}` with `proof` compressed-hex.
    #[wasm_bindgen]
    pub fn prove_withdraw_js(
        pk_bytes: &[u8],
        secret_hex: &str,
        siblings_hex: &str,
        index_bits: &str,
        recipient_hex: &str,
    ) -> String {
        let pk = load_pk(pk_bytes);
        let sibs: Vec<Fr> = siblings_hex.split('\n').filter(|s| !s.is_empty()).map(fr_from_hex).collect();
        assert_eq!(sibs.len(), DEPTH, "expected DEPTH siblings");
        let mut siblings = [Fr::from(0u64); DEPTH];
        siblings.copy_from_slice(&sibs);
        let bits: Vec<bool> = index_bits.chars().map(|c| c == '1').collect();
        assert_eq!(bits.len(), DEPTH, "expected DEPTH index bits");
        let mut index_bits_a = [false; DEPTH];
        index_bits_a.copy_from_slice(&bits);

        let inputs = WithdrawInputs {
            secret: fr_from_hex(secret_hex),
            siblings,
            index_bits: index_bits_a,
            recipient: fr_from_hex(recipient_hex),
        };
        let p = prove_withdraw(&pk, inputs, &mut rand::rngs::OsRng);
        format!(
            "{{\"a\":\"{}\",\"b\":\"{}\",\"c\":\"{}\",\"root\":\"{}\",\"nullifier\":\"{}\"}}",
            p.a, p.b, p.c, p.root, p.nullifier
        )
    }
}

#[cfg(test)]
mod test;
