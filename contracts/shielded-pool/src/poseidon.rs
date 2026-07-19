//! Poseidon2 hash over the BLS12-381 scalar field, computed on-chain with the
//! `fr_*` host functions.
//!
//! Width `t = 3` (a 2-to-1 compression, exactly what a binary Merkle tree needs).
//! We use the **Poseidon2** round structure rather than classic Poseidon because
//! the dominant on-chain cost is the number of `fr_mul` host calls, and Poseidon2
//! slashes them:
//!   * external (full) rounds mix with the matrix `M_E` = `[[2,1,1],[1,2,1],[1,1,2]]`,
//!     i.e. `out_i = x_i + (x0+x1+x2)` — **zero multiplications**, only additions;
//!   * internal (partial) rounds mix with `M_I` = diagonal + all-ones, i.e.
//!     `out_i = x_i·d_i + (x0+x1+x2)` — only `t` multiplications, not `t²`.
//!
//! Classic Poseidon here cost ~11.9M instructions/hash (585 `fr_mul`); Poseidon2
//! brings it down to the range measured in the test report.
//!
//! ## ⚠️ Parameters are a structurally-valid PLACEHOLDER, not audited constants
//!
//! Round constants and the internal diagonal are a simple deterministic sequence,
//! not nothing-up-my-sleeve values from a standard Grain-LFSR / hash-to-field
//! procedure. This is sound for measuring cost and proving the host arithmetic is
//! correct, but the constants **MUST be regenerated from a public standard
//! procedure before custodying funds**, and the identical parameters pinned into
//! the Phase 2 circuit. The permutation *structure* below is the canonical one.

use soroban_sdk::{crypto::bls12_381::Bls12381Fr as Fr, Env, Vec, U256};

pub const WIDTH: usize = 3;
pub const FULL_ROUNDS: usize = 8; // external rounds, split half/half
pub const PARTIAL_ROUNDS: usize = 57; // internal rounds
/// Round constants consumed: WIDTH per external round + 1 per internal round.
pub const ARK_LEN: usize = FULL_ROUNDS * WIDTH + PARTIAL_ROUNDS; // 81

type Bls = soroban_sdk::crypto::bls12_381::Bls12_381;

pub struct Params {
    /// Flat round constants (see `ARK_LEN`).
    pub ark: Vec<Fr>,
    /// Internal-round diagonal, length WIDTH.
    pub diag: Vec<Fr>,
}

fn fr(env: &Env, v: u32) -> Fr {
    Fr::from_u256(U256::from_u32(env, v))
}

pub fn build_params(env: &Env) -> Params {
    let mut ark = Vec::new(env);
    for k in 0..ARK_LEN as u32 {
        ark.push_back(fr(env, k + 1)); // PLACEHOLDER (see module warning)
    }
    let mut diag = Vec::new(env);
    for i in 0..WIDTH as u32 {
        diag.push_back(fr(env, i + 2)); // distinct, nonzero, ≠ 1
    }
    Params { ark, diag }
}

/// S-box `x^5` via the `fr_pow` host function (measured cheaper here than 3
/// explicit `fr_mul`s).
fn sbox(bls: &Bls, x: &Fr) -> Fr {
    bls.fr_pow(x, 5)
}

/// External (full-round) matrix: `out_i = x_i + Σ x`. Multiplication-free.
fn ext_mix(bls: &Bls, s0: &Fr, s1: &Fr, s2: &Fr) -> (Fr, Fr, Fr) {
    let sum = bls.fr_add(&bls.fr_add(s0, s1), s2);
    (
        bls.fr_add(s0, &sum),
        bls.fr_add(s1, &sum),
        bls.fr_add(s2, &sum),
    )
}

/// Internal (partial-round) matrix: `out_i = x_i·d_i + Σ x`. `t` muls.
fn int_mix(bls: &Bls, d: &Vec<Fr>, s0: &Fr, s1: &Fr, s2: &Fr) -> (Fr, Fr, Fr) {
    let sum = bls.fr_add(&bls.fr_add(s0, s1), s2);
    let m0 = bls.fr_mul(s0, &d.get_unchecked(0));
    let m1 = bls.fr_mul(s1, &d.get_unchecked(1));
    let m2 = bls.fr_mul(s2, &d.get_unchecked(2));
    (
        bls.fr_add(&m0, &sum),
        bls.fr_add(&m1, &sum),
        bls.fr_add(&m2, &sum),
    )
}

/// Poseidon2 permutation on a 2-input state, returning `state[0]`.
pub fn hash2(env: &Env, p: &Params, a: &Fr, b: &Fr) -> Fr {
    let bls = env.crypto().bls12_381();

    let mut s0 = a.clone();
    let mut s1 = b.clone();
    let mut s2 = fr(env, 0);

    // Poseidon2 begins with one external mix before any rounds.
    let (n0, n1, n2) = ext_mix(&bls, &s0, &s1, &s2);
    s0 = n0;
    s1 = n1;
    s2 = n2;

    let half = FULL_ROUNDS / 2;
    let mut rc = 0u32;

    // First block of external rounds.
    for _ in 0..half {
        s0 = bls.fr_add(&s0, &p.ark.get_unchecked(rc));
        s1 = bls.fr_add(&s1, &p.ark.get_unchecked(rc + 1));
        s2 = bls.fr_add(&s2, &p.ark.get_unchecked(rc + 2));
        rc += 3;
        s0 = sbox(&bls, &s0);
        s1 = sbox(&bls, &s1);
        s2 = sbox(&bls, &s2);
        let (m0, m1, m2) = ext_mix(&bls, &s0, &s1, &s2);
        s0 = m0;
        s1 = m1;
        s2 = m2;
    }

    // Internal rounds: RC + S-box on lane 0 only, cheap diagonal mix.
    for _ in 0..PARTIAL_ROUNDS {
        s0 = bls.fr_add(&s0, &p.ark.get_unchecked(rc));
        rc += 1;
        s0 = sbox(&bls, &s0);
        let (m0, m1, m2) = int_mix(&bls, &p.diag, &s0, &s1, &s2);
        s0 = m0;
        s1 = m1;
        s2 = m2;
    }

    // Second block of external rounds.
    for _ in 0..half {
        s0 = bls.fr_add(&s0, &p.ark.get_unchecked(rc));
        s1 = bls.fr_add(&s1, &p.ark.get_unchecked(rc + 1));
        s2 = bls.fr_add(&s2, &p.ark.get_unchecked(rc + 2));
        rc += 3;
        s0 = sbox(&bls, &s0);
        s1 = sbox(&bls, &s1);
        s2 = sbox(&bls, &s2);
        let (m0, m1, m2) = ext_mix(&bls, &s0, &s1, &s2);
        s0 = m0;
        s1 = m1;
        s2 = m2;
    }

    s0
}
