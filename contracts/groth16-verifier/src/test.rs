#![cfg(test)]
//! Phase 0 measurement harness.
//!
//! Generates a *real* Groth16 proof (trusted setup + prove) for a trivial
//! `a · b = c` circuit using arkworks, re-serializes the verifying key and proof
//! into Soroban's byte encoding, and runs the on-chain [`Groth16Verifier`]
//! against it. Two things are asserted:
//!   1. the on-chain verifier returns `true` for a valid proof and `false` for a
//!      tampered one — i.e. the pairing algebra and our serialization are correct;
//!   2. the CPU-instruction / memory budget the verify call consumes, printed for
//!      the Phase 0 feasibility question.
//!
//! NOTE: the SDK warns that native test metering *underestimates* real wasm
//! metering, so the printed numbers are a lower bound. The authoritative figure
//! comes from a testnet invocation (see the crate README).

extern crate std;

use ark_bls12_381::{Bls12_381, Fq, Fq2, Fr as ArkFr, G1Affine, G2Affine};
use ark_ec::AffineRepr;
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::Groth16;
use ark_relations::{
    lc,
    r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError},
};
use ark_snark::SNARK;
use ark_std::rand::{rngs::StdRng, SeedableRng};

use soroban_sdk::{BytesN, Env, Vec};

use crate::{Groth16Verifier, Groth16VerifierClient, Proof, VerifyingKey};

/// Minimal circuit: prove knowledge of `a`, `b` (private) with `a · b = c`,
/// where `c` is the single public input.
#[derive(Clone)]
struct MulCircuit {
    a: Option<ArkFr>,
    b: Option<ArkFr>,
}

impl ConstraintSynthesizer<ArkFr> for MulCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<ArkFr>) -> Result<(), SynthesisError> {
        let a = cs.new_witness_variable(|| self.a.ok_or(SynthesisError::AssignmentMissing))?;
        let b = cs.new_witness_variable(|| self.b.ok_or(SynthesisError::AssignmentMissing))?;
        let c = cs.new_input_variable(|| {
            let a = self.a.ok_or(SynthesisError::AssignmentMissing)?;
            let b = self.b.ok_or(SynthesisError::AssignmentMissing)?;
            Ok(a * b)
        })?;
        cs.enforce_constraint(lc!() + a, lc!() + b, lc!() + c)?;
        Ok(())
    }
}

/// Circuit with `n` public inputs: `n` independent `aᵢ · bᵢ = cᵢ` constraints,
/// each `cᵢ` public. Used to measure how on-chain verify cost scales with the
/// number of public signals — the deposit ("insertion") proof exposes ~3
/// (old root, new root, commitment), vs the 1 of the Phase 0 baseline.
#[derive(Clone)]
struct MultiMulCircuit {
    n: usize,
    witnesses: Option<std::vec::Vec<(ArkFr, ArkFr)>>,
}

impl ConstraintSynthesizer<ArkFr> for MultiMulCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<ArkFr>) -> Result<(), SynthesisError> {
        for i in 0..self.n {
            let (av, bv) = match &self.witnesses {
                Some(w) => (Some(w[i].0), Some(w[i].1)),
                None => (None, None),
            };
            let a = cs.new_witness_variable(|| av.ok_or(SynthesisError::AssignmentMissing))?;
            let b = cs.new_witness_variable(|| bv.ok_or(SynthesisError::AssignmentMissing))?;
            let c = cs.new_input_variable(|| {
                Ok(av.ok_or(SynthesisError::AssignmentMissing)?
                    * bv.ok_or(SynthesisError::AssignmentMissing)?)
            })?;
            cs.enforce_constraint(lc!() + a, lc!() + b, lc!() + c)?;
        }
        Ok(())
    }
}

// ---- arkworks -> Soroban byte serialization -------------------------------
//
// Soroban wants uncompressed, big-endian coordinates:
//   G1 = be(X) || be(Y)                              (96 bytes)
//   G2 = be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0) (192 bytes)
//   Fr = be(scalar)                                  (32 bytes)
// We pull the integer value out of each field element and lay it out ourselves
// rather than trusting ark-serialize's flag/endianness conventions.

fn fq_be(x: &Fq) -> [u8; 48] {
    let v = x.into_bigint().to_bytes_be();
    let mut out = [0u8; 48];
    out[48 - v.len()..].copy_from_slice(&v);
    out
}

fn g1_bytes(env: &Env, p: &G1Affine) -> BytesN<96> {
    let (x, y) = p.xy().expect("G1 point must not be the identity");
    let mut buf = [0u8; 96];
    buf[..48].copy_from_slice(&fq_be(&x));
    buf[48..].copy_from_slice(&fq_be(&y));
    BytesN::from_array(env, &buf)
}

fn fq2_be(x: &Fq2, out: &mut [u8]) {
    // c1 first, then c0.
    out[..48].copy_from_slice(&fq_be(&x.c1));
    out[48..96].copy_from_slice(&fq_be(&x.c0));
}

fn g2_bytes(env: &Env, p: &G2Affine) -> BytesN<192> {
    let (x, y) = p.xy().expect("G2 point must not be the identity");
    let mut buf = [0u8; 192];
    fq2_be(&x, &mut buf[..96]);
    fq2_be(&y, &mut buf[96..]);
    BytesN::from_array(env, &buf)
}

fn fr_bytes(env: &Env, s: &ArkFr) -> BytesN<32> {
    let v = s.into_bigint().to_bytes_be();
    let mut buf = [0u8; 32];
    buf[32 - v.len()..].copy_from_slice(&v);
    BytesN::from_array(env, &buf)
}

/// Build a valid proof + its Soroban-encoded verifying key, proof, and signals.
fn make_fixture(env: &Env) -> (VerifyingKey, Proof, Vec<BytesN<32>>, ArkFr) {
    let mut rng = StdRng::seed_from_u64(0);

    let a = ArkFr::from(3u64);
    let b = ArkFr::from(11u64);
    let c = a * b; // public input = 33

    let (pk, vk) = Groth16::<Bls12_381>::circuit_specific_setup(
        MulCircuit { a: Some(a), b: Some(b) },
        &mut rng,
    )
    .unwrap();

    let proof = Groth16::<Bls12_381>::prove(
        &pk,
        MulCircuit { a: Some(a), b: Some(b) },
        &mut rng,
    )
    .unwrap();

    // Cross-check natively that the proof is genuinely valid before we ever hand
    // it to the contract — isolates "bad proof" from "bad on-chain verifier".
    let pvk = Groth16::<Bls12_381>::process_vk(&vk).unwrap();
    assert!(Groth16::<Bls12_381>::verify_with_processed_vk(&pvk, &[c], &proof).unwrap());

    let mut ic = Vec::new(env);
    for p in vk.gamma_abc_g1.iter() {
        ic.push_back(g1_bytes(env, p));
    }

    let s_vk = VerifyingKey {
        alpha: g1_bytes(env, &vk.alpha_g1),
        beta: g2_bytes(env, &vk.beta_g2),
        gamma: g2_bytes(env, &vk.gamma_g2),
        delta: g2_bytes(env, &vk.delta_g2),
        ic,
    };
    let s_proof = Proof {
        a: g1_bytes(env, &proof.a),
        b: g2_bytes(env, &proof.b),
        c: g1_bytes(env, &proof.c),
    };
    let mut signals = Vec::new(env);
    signals.push_back(fr_bytes(env, &c));

    (s_vk, s_proof, signals, c)
}

/// Like `make_fixture` but with `n` public inputs — the harness for measuring
/// how verify cost scales with public-signal count (the deposit-proof spike).
fn make_fixture_n(env: &Env, n: usize) -> (VerifyingKey, Proof, Vec<BytesN<32>>) {
    let mut rng = StdRng::seed_from_u64(7);

    let witnesses: std::vec::Vec<(ArkFr, ArkFr)> =
        (0..n).map(|i| (ArkFr::from(3u64 + i as u64), ArkFr::from(11u64 + i as u64))).collect();
    let publics: std::vec::Vec<ArkFr> = witnesses.iter().map(|(a, b)| *a * *b).collect();

    let (pk, vk) = Groth16::<Bls12_381>::circuit_specific_setup(
        MultiMulCircuit { n, witnesses: None },
        &mut rng,
    )
    .unwrap();
    let proof = Groth16::<Bls12_381>::prove(
        &pk,
        MultiMulCircuit { n, witnesses: Some(witnesses) },
        &mut rng,
    )
    .unwrap();

    let pvk = Groth16::<Bls12_381>::process_vk(&vk).unwrap();
    assert!(Groth16::<Bls12_381>::verify_with_processed_vk(&pvk, &publics, &proof).unwrap());

    let mut ic = Vec::new(env);
    for p in vk.gamma_abc_g1.iter() {
        ic.push_back(g1_bytes(env, p));
    }
    let s_vk = VerifyingKey {
        alpha: g1_bytes(env, &vk.alpha_g1),
        beta: g2_bytes(env, &vk.beta_g2),
        gamma: g2_bytes(env, &vk.gamma_g2),
        delta: g2_bytes(env, &vk.delta_g2),
        ic,
    };
    let s_proof = Proof {
        a: g1_bytes(env, &proof.a),
        b: g2_bytes(env, &proof.b),
        c: g1_bytes(env, &proof.c),
    };
    let mut signals = Vec::new(env);
    for c in &publics {
        signals.push_back(fr_bytes(env, c));
    }
    (s_vk, s_proof, signals)
}

/// Phase 1 deposit-proof spike: verify cost as a function of public-input count.
/// A real insertion proof exposes ~3 public inputs (old root, new root,
/// commitment); this confirms verify stays ~Phase-0 cost as they grow.
#[test]
fn verify_cost_vs_public_inputs() {
    let env = Env::default();
    let id = env.register(Groth16Verifier, ());
    let client = Groth16VerifierClient::new(&env, &id);

    std::println!("──────────────────────────────────────────────");
    std::println!(" Groth16 verify — cost vs #public inputs (native, LOWER BOUND)");
    for n in [1usize, 3, 4, 6] {
        let (vk, proof, signals) = make_fixture_n(&env, n);
        env.cost_estimate().budget().reset_unlimited();
        let ok = client.verify(&vk, &proof, &signals);
        let cpu = env.cost_estimate().budget().cpu_instruction_cost();
        assert!(ok, "n={n} proof must verify");
        std::println!("   {n} public input(s): {cpu} insns");
    }
    std::println!("   Soroban tx limit  : 100,000,000 insns");
    std::println!("──────────────────────────────────────────────");
}

/// Emits a 3-public-input ("deposit-shaped") fixture for authoritative testnet
/// measurement. Run with `cargo test emit_deposit_fixture -- --ignored`.
#[test]
#[ignore]
fn emit_deposit_fixture() {
    let env = Env::default();
    let (vk, proof, signals) = make_fixture_n(&env, 3);

    let hex96 = |b: &BytesN<96>| to_hex(&b.to_array());
    let hex192 = |b: &BytesN<192>| to_hex(&b.to_array());
    let hex32 = |b: &BytesN<32>| to_hex(&b.to_array());

    let mut ic_items = std::vec::Vec::new();
    for i in 0..vk.ic.len() {
        ic_items.push(std::format!("\"{}\"", hex96(&vk.ic.get_unchecked(i))));
    }
    let vk_json = std::format!(
        "{{\"alpha\":\"{}\",\"beta\":\"{}\",\"gamma\":\"{}\",\"delta\":\"{}\",\"ic\":[{}]}}",
        hex96(&vk.alpha),
        hex192(&vk.beta),
        hex192(&vk.gamma),
        hex192(&vk.delta),
        ic_items.join(",")
    );
    let proof_json = std::format!(
        "{{\"a\":\"{}\",\"b\":\"{}\",\"c\":\"{}\"}}",
        hex96(&proof.a),
        hex192(&proof.b),
        hex96(&proof.c)
    );
    let mut sig_items = std::vec::Vec::new();
    for i in 0..signals.len() {
        sig_items.push(std::format!("\"{}\"", hex32(&signals.get_unchecked(i))));
    }
    let signals_json = std::format!("[{}]", sig_items.join(","));

    let dir = "target/phase1-fixture";
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(std::format!("{dir}/vk.json"), &vk_json).unwrap();
    std::fs::write(std::format!("{dir}/proof.json"), &proof_json).unwrap();
    std::fs::write(std::format!("{dir}/signals.json"), &signals_json).unwrap();
    std::println!("wrote 3-input deposit fixture to {dir}/");
}

#[test]
fn valid_proof_verifies_and_reports_budget() {
    let env = Env::default();
    let id = env.register(Groth16Verifier, ());
    let client = Groth16VerifierClient::new(&env, &id);

    let (vk, proof, signals, _c) = make_fixture(&env);

    // Reset the tracker (and lift limits) so we measure only the verify call.
    env.cost_estimate().budget().reset_unlimited();
    let ok = client.verify(&vk, &proof, &signals);
    let cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let mem = env.cost_estimate().budget().memory_bytes_cost();

    assert!(ok, "valid Groth16 proof must verify on-chain");

    std::println!("──────────────────────────────────────────────");
    std::println!(" Groth16 verify — Phase 0 budget (native, LOWER BOUND)");
    std::println!("   CPU instructions : {}", cpu);
    std::println!("   Memory bytes     : {}", mem);
    std::println!("   Soroban tx limit : 100,000,000 CPU insns");
    std::println!("──────────────────────────────────────────────");
    env.cost_estimate().budget().print();
}

/// Emits the fixture as `stellar contract invoke`-ready JSON files so the same
/// proof can be verified on real testnet and metered authoritatively. Ignored by
/// default; run with `cargo test -p groth16-verifier emit_fixture -- --ignored`.
#[test]
#[ignore]
fn emit_fixture_json() {
    let env = Env::default();
    let (vk, proof, signals, _c) = make_fixture(&env);

    let hex96 = |b: &BytesN<96>| -> std::string::String { to_hex(&b.to_array()) };
    let hex192 = |b: &BytesN<192>| -> std::string::String { to_hex(&b.to_array()) };
    let hex32 = |b: &BytesN<32>| -> std::string::String { to_hex(&b.to_array()) };

    let mut ic_items = std::vec::Vec::new();
    for i in 0..vk.ic.len() {
        ic_items.push(std::format!("\"{}\"", hex96(&vk.ic.get_unchecked(i))));
    }
    let vk_json = std::format!(
        "{{\"alpha\":\"{}\",\"beta\":\"{}\",\"gamma\":\"{}\",\"delta\":\"{}\",\"ic\":[{}]}}",
        hex96(&vk.alpha),
        hex192(&vk.beta),
        hex192(&vk.gamma),
        hex192(&vk.delta),
        ic_items.join(",")
    );
    let proof_json = std::format!(
        "{{\"a\":\"{}\",\"b\":\"{}\",\"c\":\"{}\"}}",
        hex96(&proof.a),
        hex192(&proof.b),
        hex96(&proof.c)
    );
    let signals_json = std::format!("[\"{}\"]", hex32(&signals.get_unchecked(0)));

    let dir = "target/phase0-fixture";
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(std::format!("{dir}/vk.json"), &vk_json).unwrap();
    std::fs::write(std::format!("{dir}/proof.json"), &proof_json).unwrap();
    std::fs::write(std::format!("{dir}/signals.json"), &signals_json).unwrap();
    std::println!("wrote fixture JSON to {dir}/");
}

fn to_hex(bytes: &[u8]) -> std::string::String {
    let mut s = std::string::String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&std::format!("{:02x}", b));
    }
    s
}

#[test]
fn tampered_signal_is_rejected() {
    let env = Env::default();
    let id = env.register(Groth16Verifier, ());
    let client = Groth16VerifierClient::new(&env, &id);

    let (vk, proof, _signals, c) = make_fixture(&env);

    // Claim a different public input (c + 1) than the proof was made for.
    let wrong = c + ArkFr::from(1u64);
    let mut bad_signals = Vec::new(&env);
    bad_signals.push_back(fr_bytes(&env, &wrong));

    assert!(
        !client.verify(&vk, &proof, &bad_signals),
        "a proof must not verify against the wrong public input"
    );
}
