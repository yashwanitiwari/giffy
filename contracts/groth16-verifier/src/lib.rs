#![no_std]

//! Groth16 verifier on BLS12-381 — Phase 0 spike for ZK-sealed gift amounts.
//!
//! This contract verifies a Groth16 zk-SNARK proof entirely on-chain using the
//! BLS12-381 host functions Soroban gained in Protocol 22. It is deliberately
//! generic: it takes a verifying key, a proof, and the public signals, and
//! checks the standard Groth16 pairing equation. The point of the spike is to
//! measure what that costs (see the budget test), not yet to wire it into a
//! shielded pool — that is Phase 1.
//!
//! ## The equation
//!
//! For a verifying key `(alpha, beta, gamma, delta, IC[])`, proof `(A, B, C)`
//! and public signals `s[]`, Groth16 accepts iff
//!
//! ```text
//!   e(A, B) == e(alpha, beta) · e(vk_x, gamma) · e(C, delta)
//! ```
//!
//! where `vk_x = IC[0] + Σ s[i]·IC[i+1]`. We move everything to one side so it
//! becomes a single multi-pairing identity check (what `pairing_check` computes):
//!
//! ```text
//!   e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
//! ```
//!
//! `-A` is obtained as `(r-1)·A`, since multiplying a prime-order-subgroup point
//! by `r-1` negates it — done here with the `fr_sub`/`g1_mul` host functions so
//! no field arithmetic is open-coded.

use soroban_sdk::{
    contract, contractimpl, contracttype,
    crypto::bls12_381::{Bls12381Fr as Fr, Bls12381G1Affine as G1, Bls12381G2Affine as G2},
    vec, BytesN, Env, Vec, U256,
};

/// Groth16 verifying key, with every group element in Soroban's uncompressed
/// big-endian encoding (G1 = 96 bytes, G2 = 192 bytes).
#[contracttype]
#[derive(Clone)]
pub struct VerifyingKey {
    pub alpha: BytesN<96>,       // G1
    pub beta: BytesN<192>,       // G2
    pub gamma: BytesN<192>,      // G2
    pub delta: BytesN<192>,      // G2
    /// IC / gamma_abc: length is (number of public signals) + 1.
    pub ic: Vec<BytesN<96>>,     // G1[]
}

/// A Groth16 proof: `A` and `C` in G1, `B` in G2.
#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: BytesN<96>,   // G1
    pub b: BytesN<192>,  // G2
    pub c: BytesN<96>,   // G1
}

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// Verify a Groth16 proof against `vk` and the `signals` (each a 32-byte
    /// big-endian scalar in Fr). Returns `true` iff the proof is valid.
    ///
    /// Panics (traps) if `ic` is not exactly `signals.len() + 1` long — a
    /// malformed key must never silently pass.
    pub fn verify(env: Env, vk: VerifyingKey, proof: Proof, signals: Vec<BytesN<32>>) -> bool {
        let bls = env.crypto().bls12_381();

        if vk.ic.len() != signals.len() + 1 {
            panic!("verifying key IC length must be signals + 1");
        }

        // vk_x = IC[0] + Σ signals[i] · IC[i+1]
        let mut vk_x = G1::from_bytes(vk.ic.get_unchecked(0));
        if signals.len() > 0 {
            let mut points: Vec<G1> = Vec::new(&env);
            let mut scalars: Vec<Fr> = Vec::new(&env);
            for i in 0..signals.len() {
                points.push_back(G1::from_bytes(vk.ic.get_unchecked(i + 1)));
                scalars.push_back(Fr::from_bytes(signals.get_unchecked(i)));
            }
            let sum = bls.g1_msm(points, scalars);
            vk_x = bls.g1_add(&vk_x, &sum);
        }

        // -A = (r - 1) · A, computed as (0 - 1) in Fr then scalar-mul.
        let zero = Fr::from_u256(U256::from_u32(&env, 0));
        let one = Fr::from_u256(U256::from_u32(&env, 1));
        let neg_one = bls.fr_sub(&zero, &one);
        let neg_a = bls.g1_mul(&G1::from_bytes(proof.a), &neg_one);

        // e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
        let g1s = vec![
            &env,
            neg_a,
            G1::from_bytes(vk.alpha),
            vk_x,
            G1::from_bytes(proof.c),
        ];
        let g2s = vec![
            &env,
            G2::from_bytes(proof.b),
            G2::from_bytes(vk.beta),
            G2::from_bytes(vk.gamma),
            G2::from_bytes(vk.delta),
        ];

        bls.pairing_check(g1s, g2s)
    }
}

#[cfg(test)]
mod test;
