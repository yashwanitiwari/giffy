#![cfg(test)]
//! Frontend-integration de-risk: measure proving-key size and proving time for
//! the withdraw circuit. These are the numbers that decide whether client-side
//! proving is a viable UX. Native prove time is a LOWER BOUND on the browser
//! (wasm is typically 3–8× slower); the wasm figure comes from the wasm-pack
//! harness (see README).

extern crate std;
use std::time::Instant;

use ark_bls12_381::{Bls12_381, Fr};
use ark_ec::AffineRepr;
use ark_ff::UniformRand;
use ark_groth16::Groth16;
use ark_serialize::CanonicalSerialize;
use ark_snark::SNARK;
use ark_std::rand::{rngs::StdRng, SeedableRng};

use zk_circuits::{WithdrawCircuit, DEPTH};

use crate::{note_commitment, prove_withdraw, WithdrawInputs};

#[test]
fn measure_pk_size_and_prove_time() {
    let mut rng = StdRng::seed_from_u64(1);

    // Offline trusted setup (done once; ships the pk to the client).
    let setup = WithdrawCircuit {
        root: None, nullifier: None, recipient: None,
        secret: None, siblings: None, index_bits: None,
    };
    let (pk, vk) = Groth16::<Bls12_381>::circuit_specific_setup(setup, &mut rng).unwrap();

    let mut pk_c = Vec::new();
    pk.serialize_compressed(&mut pk_c).unwrap();
    let mut pk_u = Vec::new();
    pk.serialize_uncompressed(&mut pk_u).unwrap();
    let mut vk_c = Vec::new();
    vk.serialize_compressed(&mut vk_c).unwrap();

    // A real note + arbitrary path (path validity doesn't affect timing).
    let secret = Fr::from(0xC0FFEEu64);
    let _leaf = note_commitment(&secret);
    let siblings: [Fr; DEPTH] = std::array::from_fn(|_| Fr::rand(&mut rng));
    let index_bits: [bool; DEPTH] = std::array::from_fn(|i| i % 2 == 0);
    let recipient = Fr::from(0x515Eu64);

    // Warm one, then average a few for a stable prove-time number.
    let runs = 5;
    let mut total = std::time::Duration::ZERO;
    for i in 0..runs + 1 {
        let inputs = WithdrawInputs {
            secret,
            siblings,
            index_bits,
            recipient,
        };
        let t = Instant::now();
        let p = prove_withdraw(&pk, inputs, &mut rng);
        let dt = t.elapsed();
        if i > 0 {
            total += dt;
        }
        assert_eq!(p.a.len(), 192); // 96 bytes uncompressed G1
    }
    let avg_ms = total.as_secs_f64() * 1000.0 / runs as f64;

    // Count constraints for context.
    use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystem};
    let cs = ConstraintSystem::<Fr>::new_ref();
    WithdrawCircuit::assign(secret, siblings, index_bits, recipient)
        .0
        .generate_constraints(cs.clone())
        .unwrap();
    let num_constraints = cs.num_constraints();

    std::println!("──────────────────────────────────────────────");
    std::println!(" Withdraw prover — frontend de-risk (native)");
    std::println!("   circuit constraints        : {num_constraints}");
    std::println!("   proving key (compressed)   : {} KB", pk_c.len() / 1024);
    std::println!("   proving key (uncompressed) : {} KB", pk_u.len() / 1024);
    std::println!("   verifying key (compressed) : {} bytes", vk_c.len());
    std::println!("   proof size (compressed)    : 192 bytes (Groth16, fixed)");
    std::println!("   NATIVE prove time (avg)    : {:.1} ms  (browser ~3-8x)", avg_ms);
    std::println!("──────────────────────────────────────────────");

    // Sanity gate: native proving must be fast enough that even 8x is tolerable.
    assert!(avg_ms < 3000.0, "native prove unexpectedly slow: {avg_ms} ms");
}

#[test]
#[ignore]
fn emit_wasm_fixture() {
    use ark_serialize::CanonicalSerialize;
    let mut rng = StdRng::seed_from_u64(1);
    let setup = WithdrawCircuit {
        root: None, nullifier: None, recipient: None,
        secret: None, siblings: None, index_bits: None,
    };
    let (pk, _vk) = Groth16::<Bls12_381>::circuit_specific_setup(setup, &mut rng).unwrap();
    let mut pk_u = Vec::new();
    pk.serialize_uncompressed(&mut pk_u).unwrap();
    std::fs::create_dir_all("pkg-fixture").unwrap();
    std::fs::write("pkg-fixture/pk.bin", &pk_u).unwrap();

    // Emit the matching verifying key in Soroban JSON so a browser-generated
    // proof can be checked on the deployed on-chain verifier.
    let (vk, _) = (_vk, ());
    let fq_be = |x: &ark_bls12_381::Fq| {
        let v = ark_ff::PrimeField::into_bigint(*x);
        let bytes = ark_ff::BigInteger::to_bytes_be(&v);
        let mut o = [0u8; 48];
        o[48 - bytes.len()..].copy_from_slice(&bytes);
        o
    };
    let hexs = |b: &[u8]| b.iter().map(|x| std::format!("{:02x}", x)).collect::<String>();
    let g1 = |p: &ark_bls12_381::G1Affine| {
        let (x, y) = ark_ec::AffineRepr::xy(p).unwrap();
        let mut b = [0u8; 96];
        b[..48].copy_from_slice(&fq_be(&x));
        b[48..].copy_from_slice(&fq_be(&y));
        std::format!("\"{}\"", hexs(&b))
    };
    let g2 = |p: &ark_bls12_381::G2Affine| {
        let (x, y) = ark_ec::AffineRepr::xy(p).unwrap();
        let mut b = [0u8; 192];
        b[..48].copy_from_slice(&fq_be(&x.c1));
        b[48..96].copy_from_slice(&fq_be(&x.c0));
        b[96..144].copy_from_slice(&fq_be(&y.c1));
        b[144..].copy_from_slice(&fq_be(&y.c0));
        std::format!("\"{}\"", hexs(&b))
    };
    let ic: std::vec::Vec<String> = vk.gamma_abc_g1.iter().map(|p| g1(p)).collect();
    let vk_json = std::format!(
        "{{\"alpha\":{},\"beta\":{},\"gamma\":{},\"delta\":{},\"ic\":[{}]}}",
        g1(&vk.alpha_g1),
        g2(&vk.beta_g2),
        g2(&vk.gamma_g2),
        g2(&vk.delta_g2),
        ic.join(",")
    );
    std::fs::write("pkg-fixture/vk.json", &vk_json).unwrap();
    std::println!("wrote pkg-fixture/pk.bin ({} bytes) + vk.json", pk_u.len());
}
