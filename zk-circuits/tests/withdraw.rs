//! Phase 2 slice: prove the withdraw circuit, verify natively, and emit a
//! Soroban-format fixture for on-chain verification against the deployed
//! Phase 0 verifier.

use ark_bls12_381::{Bls12_381, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ec::AffineRepr;
use ark_ff::{BigInteger, PrimeField, UniformRand};
use ark_groth16::Groth16;
use ark_snark::SNARK;
use ark_std::rand::{rngs::StdRng, SeedableRng};

use zk_circuits::poseidon2::{hash2, hash2_var};
use zk_circuits::{WithdrawCircuit, DEPTH};

// ---- Soroban byte serialization (matches groth16-verifier) ------------------

fn fq_be(x: &Fq) -> [u8; 48] {
    let v = x.into_bigint().to_bytes_be();
    let mut out = [0u8; 48];
    out[48 - v.len()..].copy_from_slice(&v);
    out
}
fn g1_hex(p: &G1Affine) -> String {
    let (x, y) = p.xy().expect("G1 not identity");
    let mut b = [0u8; 96];
    b[..48].copy_from_slice(&fq_be(&x));
    b[48..].copy_from_slice(&fq_be(&y));
    to_hex(&b)
}
fn fq2_be(x: &Fq2, out: &mut [u8]) {
    out[..48].copy_from_slice(&fq_be(&x.c1));
    out[48..96].copy_from_slice(&fq_be(&x.c0));
}
fn g2_hex(p: &G2Affine) -> String {
    let (x, y) = p.xy().expect("G2 not identity");
    let mut b = [0u8; 192];
    fq2_be(&x, &mut b[..96]);
    fq2_be(&y, &mut b[96..]);
    to_hex(&b)
}
fn fr_hex(s: &Fr) -> String {
    let v = s.into_bigint().to_bytes_be();
    let mut b = [0u8; 32];
    b[32 - v.len()..].copy_from_slice(&v);
    to_hex(&b)
}
fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// The gadget and native Poseidon2 must produce identical outputs, else a
/// commitment made on-chain would never satisfy the circuit.
#[test]
fn gadget_matches_native_poseidon() {
    use ark_r1cs_std::alloc::AllocVar;
    use ark_r1cs_std::fields::fp::FpVar;
    use ark_r1cs_std::R1CSVar;
    use ark_relations::r1cs::ConstraintSystem;

    let cs = ConstraintSystem::<Fr>::new_ref();
    for (a, b) in [(3u64, 5u64), (0, 0), (999, 12345), (7, 7)] {
        let (af, bf) = (Fr::from(a), Fr::from(b));
        let av = FpVar::new_witness(cs.clone(), || Ok(af)).unwrap();
        let bv = FpVar::new_witness(cs.clone(), || Ok(bf)).unwrap();
        let got = hash2_var(&av, &bv).unwrap().value().unwrap();
        assert_eq!(
            got,
            hash2(af, bf),
            "gadget vs native mismatch for ({a},{b})"
        );
    }
    assert!(cs.is_satisfied().unwrap());
}

#[test]
fn withdraw_proof_valid_and_fixture_emitted() {
    let mut rng = StdRng::seed_from_u64(42);

    // A note at a known position, with random sibling path.
    let secret = Fr::from(0xC0FFEEu64);
    let siblings: [Fr; DEPTH] = std::array::from_fn(|_| Fr::rand(&mut rng));
    let index_bits: [bool; DEPTH] = std::array::from_fn(|i| (i % 2) == 0);
    let recipient = Fr::from(0xBEEFu64);

    let (circuit, root, nullifier) =
        WithdrawCircuit::assign(secret, siblings, index_bits, recipient);

    // Trusted setup on the circuit's structure (unassigned instance).
    let setup_circuit = WithdrawCircuit {
        root: None,
        nullifier: None,
        recipient: None,
        secret: None,
        siblings: None,
        index_bits: None,
    };
    let (pk, vk) = Groth16::<Bls12_381>::circuit_specific_setup(setup_circuit, &mut rng).unwrap();

    let proof = Groth16::<Bls12_381>::prove(&pk, circuit, &mut rng).unwrap();

    // Native verify with the public inputs in the contract's fixed order.
    let publics = [root, nullifier, recipient];
    let pvk = Groth16::<Bls12_381>::process_vk(&vk).unwrap();
    assert!(
        Groth16::<Bls12_381>::verify_with_processed_vk(&pvk, &publics, &proof).unwrap(),
        "withdraw proof must verify natively"
    );

    // A wrong recipient must NOT verify (front-running protection is real).
    let bad = [root, nullifier, Fr::from(0xDEADu64)];
    assert!(
        !Groth16::<Bls12_381>::verify_with_processed_vk(&pvk, &bad, &proof).unwrap(),
        "proof must not verify against a substituted recipient"
    );

    // Emit Soroban-format JSON for the on-chain verifier.
    let ic: Vec<String> = vk
        .gamma_abc_g1
        .iter()
        .map(|p| format!("\"{}\"", g1_hex(p)))
        .collect();
    let vk_json = format!(
        "{{\"alpha\":\"{}\",\"beta\":\"{}\",\"gamma\":\"{}\",\"delta\":\"{}\",\"ic\":[{}]}}",
        g1_hex(&vk.alpha_g1),
        g2_hex(&vk.beta_g2),
        g2_hex(&vk.gamma_g2),
        g2_hex(&vk.delta_g2),
        ic.join(",")
    );
    let proof_json = format!(
        "{{\"a\":\"{}\",\"b\":\"{}\",\"c\":\"{}\"}}",
        g1_hex(&proof.a),
        g2_hex(&proof.b),
        g1_hex(&proof.c)
    );
    let signals_json = format!(
        "[\"{}\",\"{}\",\"{}\"]",
        fr_hex(&root),
        fr_hex(&nullifier),
        fr_hex(&recipient)
    );

    let dir = "target/phase2-fixture";
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(format!("{dir}/vk.json"), &vk_json).unwrap();
    std::fs::write(format!("{dir}/proof.json"), &proof_json).unwrap();
    std::fs::write(format!("{dir}/signals.json"), &signals_json).unwrap();
    println!(
        "wrote withdraw fixture ({} public inputs) to {dir}/",
        publics.len()
    );
}
