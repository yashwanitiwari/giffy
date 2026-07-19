//! Poseidon2 over the BLS12-381 scalar field, in two forms that MUST agree:
//!   * `hash2` — native, for computing witness values;
//!   * `hash2_var` — the R1CS gadget, for in-circuit constraints.
//!
//! Both mirror `contracts/shielded-pool/src/poseidon.rs` exactly (same width,
//! round split, round constants, internal diagonal, and S-box), so a commitment
//! computed on-chain and one proven in-circuit are the same field element.
//!
//! ⚠️ The round constants (`ark[k] = k+1`) and diagonal (`[2,3,4]`) are the same
//! deterministic PLACEHOLDER as the contract. Production must regenerate both
//! from a standard nothing-up-my-sleeve procedure and update all three copies
//! (contract, native mirror, this gadget) together.

use ark_bls12_381::Fr;
use ark_ff::Field;
use ark_r1cs_std::fields::fp::FpVar;
use ark_r1cs_std::fields::FieldVar;
use ark_relations::r1cs::SynthesisError;

pub const WIDTH: usize = 3;
pub const FULL_ROUNDS: usize = 8;
pub const PARTIAL_ROUNDS: usize = 57;
pub const ARK_LEN: usize = FULL_ROUNDS * WIDTH + PARTIAL_ROUNDS; // 81

pub fn ark(k: usize) -> Fr {
    Fr::from((k + 1) as u64)
}
pub fn diag(i: usize) -> Fr {
    Fr::from((i + 2) as u64)
}

// ---- native -----------------------------------------------------------------

fn sbox(x: Fr) -> Fr {
    x.pow([5u64])
}
fn ext_mix(s: [Fr; 3]) -> [Fr; 3] {
    let sum = s[0] + s[1] + s[2];
    [s[0] + sum, s[1] + sum, s[2] + sum]
}
fn int_mix(s: [Fr; 3]) -> [Fr; 3] {
    let sum = s[0] + s[1] + s[2];
    [s[0] * diag(0) + sum, s[1] * diag(1) + sum, s[2] * diag(2) + sum]
}

/// Native 2-to-1 Poseidon2 compression.
pub fn hash2(a: Fr, b: Fr) -> Fr {
    let mut s = ext_mix([a, b, Fr::from(0u64)]);
    let half = FULL_ROUNDS / 2;
    let mut rc = 0usize;
    for _ in 0..half {
        for i in 0..3 {
            s[i] += ark(rc + i);
        }
        rc += 3;
        for i in 0..3 {
            s[i] = sbox(s[i]);
        }
        s = ext_mix(s);
    }
    for _ in 0..PARTIAL_ROUNDS {
        s[0] += ark(rc);
        rc += 1;
        s[0] = sbox(s[0]);
        s = int_mix(s);
    }
    for _ in 0..half {
        for i in 0..3 {
            s[i] += ark(rc + i);
        }
        rc += 3;
        for i in 0..3 {
            s[i] = sbox(s[i]);
        }
        s = ext_mix(s);
    }
    s[0]
}

// ---- R1CS gadget ------------------------------------------------------------

fn sbox_var(x: &FpVar<Fr>) -> Result<FpVar<Fr>, SynthesisError> {
    let x2 = x * x;
    let x4 = &x2 * &x2;
    Ok(&x4 * x)
}
fn ext_mix_var(s: [FpVar<Fr>; 3]) -> [FpVar<Fr>; 3] {
    let sum = &s[0] + &s[1] + &s[2];
    [&s[0] + &sum, &s[1] + &sum, &s[2] + &sum]
}
fn int_mix_var(s: [FpVar<Fr>; 3]) -> [FpVar<Fr>; 3] {
    let sum = &s[0] + &s[1] + &s[2];
    [
        &s[0] * diag(0) + &sum,
        &s[1] * diag(1) + &sum,
        &s[2] * diag(2) + &sum,
    ]
}

/// In-circuit 2-to-1 Poseidon2 compression. Mirrors `hash2`.
pub fn hash2_var(a: &FpVar<Fr>, b: &FpVar<Fr>) -> Result<FpVar<Fr>, SynthesisError> {
    let zero = FpVar::<Fr>::constant(Fr::from(0u64));
    let mut s = ext_mix_var([a.clone(), b.clone(), zero]);
    let half = FULL_ROUNDS / 2;
    let mut rc = 0usize;
    for _ in 0..half {
        for i in 0..3 {
            s[i] = &s[i] + FpVar::constant(ark(rc + i));
        }
        rc += 3;
        for i in 0..3 {
            s[i] = sbox_var(&s[i])?;
        }
        s = ext_mix_var(s);
    }
    for _ in 0..PARTIAL_ROUNDS {
        s[0] = &s[0] + FpVar::constant(ark(rc));
        rc += 1;
        s[0] = sbox_var(&s[0])?;
        s = int_mix_var(s);
    }
    for _ in 0..half {
        for i in 0..3 {
            s[i] = &s[i] + FpVar::constant(ark(rc + i));
        }
        rc += 3;
        for i in 0..3 {
            s[i] = sbox_var(&s[i])?;
        }
        s = ext_mix_var(s);
    }
    let [out, _, _] = s;
    Ok(out)
}
