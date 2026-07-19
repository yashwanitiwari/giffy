#![cfg(test)]
//! Phase 2 end-to-end: a real deposit → withdraw → double-spend-rejected flow
//! against the pool contract, using the actual Groth16 verifier (cross-contract)
//! and a genuine withdraw proof generated from `zk-circuits` against the exact
//! tree the pool builds on-chain.

extern crate std;

use ark_bls12_381::{Bls12_381, Fq, Fr as ArkFr, G1Affine, G2Affine};
use ark_ec::AffineRepr;
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::Groth16;
use ark_snark::SNARK;
use ark_std::rand::{rngs::StdRng, SeedableRng};

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, BytesN, Env, Vec as SVec};

use groth16_verifier::{Groth16Verifier, Proof as SProof, VerifyingKey as SVk};
use zk_circuits::poseidon2::hash2 as nhash;
use zk_circuits::{WithdrawCircuit, DEPTH};

use crate::{Config, ShieldedPool, ShieldedPoolClient};

// ---- arkworks -> Soroban byte helpers --------------------------------------

fn fq_be(x: &Fq) -> [u8; 48] {
    let v = x.into_bigint().to_bytes_be();
    let mut out = [0u8; 48];
    out[48 - v.len()..].copy_from_slice(&v);
    out
}
fn g1_bytesn(env: &Env, p: &G1Affine) -> BytesN<96> {
    let (x, y) = p.xy().unwrap();
    let mut b = [0u8; 96];
    b[..48].copy_from_slice(&fq_be(&x));
    b[48..].copy_from_slice(&fq_be(&y));
    BytesN::from_array(env, &b)
}
fn g2_bytesn(env: &Env, p: &G2Affine) -> BytesN<192> {
    let (x, y) = p.xy().unwrap();
    let mut b = [0u8; 192];
    b[..48].copy_from_slice(&fq_be(&x.c1));
    b[48..96].copy_from_slice(&fq_be(&x.c0));
    b[96..144].copy_from_slice(&fq_be(&y.c1));
    b[144..].copy_from_slice(&fq_be(&y.c0));
    BytesN::from_array(env, &b)
}
fn fr_bytesn(env: &Env, s: &ArkFr) -> BytesN<32> {
    let v = s.into_bigint().to_bytes_be();
    let mut b = [0u8; 32];
    b[32 - v.len()..].copy_from_slice(&v);
    BytesN::from_array(env, &b)
}

fn to_soroban_vk(env: &Env, vk: &ark_groth16::VerifyingKey<Bls12_381>) -> SVk {
    let mut ic: SVec<BytesN<96>> = SVec::new(env);
    for p in vk.gamma_abc_g1.iter() {
        ic.push_back(g1_bytesn(env, p));
    }
    SVk {
        alpha: g1_bytesn(env, &vk.alpha_g1),
        beta: g2_bytesn(env, &vk.beta_g2),
        gamma: g2_bytesn(env, &vk.gamma_g2),
        delta: g2_bytesn(env, &vk.delta_g2),
        ic,
    }
}
fn to_soroban_proof(env: &Env, pr: &ark_groth16::Proof<Bls12_381>) -> SProof {
    SProof {
        a: g1_bytesn(env, &pr.a),
        b: g2_bytesn(env, &pr.b),
        c: g1_bytesn(env, &pr.c),
    }
}

// ---- native full-tree mirror of the contract's incremental insertion --------

const N_LEAVES: usize = 1 << DEPTH;

struct Tree {
    leaves: std::vec::Vec<ArkFr>,
}
impl Tree {
    fn new() -> Self {
        Tree {
            leaves: std::vec![ArkFr::from(0u64); N_LEAVES],
        }
    }
    fn set(&mut self, i: usize, v: ArkFr) {
        self.leaves[i] = v;
    }
    /// Root, plus the authentication path (siblings + right-child bits) for leaf `t`.
    fn root_and_path(&self, t: usize) -> (ArkFr, [ArkFr; DEPTH], [bool; DEPTH]) {
        let mut level = self.leaves.clone();
        let mut siblings = [ArkFr::from(0u64); DEPTH];
        let mut bits = [false; DEPTH];
        let mut pos = t;
        for d in 0..DEPTH {
            let sib = pos ^ 1;
            siblings[d] = level[sib];
            bits[d] = (pos & 1) == 1;
            let mut next = std::vec::Vec::with_capacity(level.len() / 2);
            let mut j = 0;
            while j < level.len() {
                next.push(nhash(level[j], level[j + 1]));
                j += 2;
            }
            level = next;
            pos >>= 1;
        }
        (level[0], siblings, bits)
    }
}

// ---- token helper -----------------------------------------------------------

fn make_token<'a>(
    env: &Env,
    admin: &Address,
) -> (
    Address,
    token::StellarAssetClient<'a>,
    token::TokenClient<'a>,
) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let addr = sac.address();
    (
        addr.clone(),
        token::StellarAssetClient::new(env, &addr),
        token::TokenClient::new(env, &addr),
    )
}

#[test]
fn on_chain_poseidon_matches_circuit_gadget_native() {
    let env = Env::default();
    let id = env.register(ShieldedPool, ());
    let client = ShieldedPoolClient::new(&env, &id);
    for (a, b) in [(7u64, 11u64), (0, 0), (1, 999_999)] {
        let got = client
            .hash(
                &fr_bytesn(&env, &ArkFr::from(a)),
                &fr_bytesn(&env, &ArkFr::from(b)),
            )
            .to_array();
        assert_eq!(
            got,
            fr_bytesn(&env, &nhash(ArkFr::from(a), ArkFr::from(b))).to_array()
        );
    }
}

#[test]
fn deposit_withdraw_end_to_end_and_double_spend_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    // Contracts: the Phase 0 verifier + the pool.
    let verifier_id = env.register(Groth16Verifier, ());
    let pool_id = env.register(ShieldedPool, ());
    let pool = ShieldedPoolClient::new(&env, &pool_id);

    // Token + actors.
    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_addr, token_admin, token) = make_token(&env, &admin);
    let denom: i128 = 100;
    token_admin.mint(&depositor, &1000);

    // Our note (at leaf index 1) plus two decoy notes at indices 0 and 2.
    let mut rng = StdRng::seed_from_u64(2024);
    let secret = ArkFr::from(0xC0FFEEu64);
    let our_leaf = nhash(secret, ArkFr::from(0u64));
    let decoy0 = nhash(ArkFr::from(111u64), ArkFr::from(0u64));
    let decoy2 = nhash(ArkFr::from(222u64), ArkFr::from(0u64));

    // Native tree mirrors the on-chain insertion order (0,1,2).
    let mut tree = Tree::new();
    tree.set(0, decoy0);
    tree.set(1, our_leaf);
    tree.set(2, decoy2);
    let (native_root, siblings, bits) = tree.root_and_path(1);

    // Recipient binding: a field the proof commits to.
    let recipient_field = ArkFr::from(0x515Eu64);

    // Real proof for our note.
    let (circuit, circ_root, nullifier) =
        WithdrawCircuit::assign(secret, siblings, bits, recipient_field);
    assert_eq!(
        circ_root, native_root,
        "circuit root must equal native tree root"
    );

    let setup = WithdrawCircuit {
        root: None,
        nullifier: None,
        recipient: None,
        secret: None,
        siblings: None,
        index_bits: None,
    };
    let (pk, vk) = Groth16::<Bls12_381>::circuit_specific_setup(setup, &mut rng).unwrap();
    let proof = Groth16::<Bls12_381>::prove(&pk, circuit, &mut rng).unwrap();

    // Initialize the pool with the token, denom, verifier, and vk.
    let config = Config {
        token: token_addr.clone(),
        denom,
        verifier: verifier_id.clone(),
    };
    pool.initialize(&config, &to_soroban_vk(&env, &vk));

    // Deposit all three commitments in order — the pool builds the tree on-chain.
    assert_eq!(pool.deposit(&depositor, &fr_bytesn(&env, &decoy0)), 0);
    assert_eq!(pool.deposit(&depositor, &fr_bytesn(&env, &our_leaf)), 1);
    assert_eq!(pool.deposit(&depositor, &fr_bytesn(&env, &decoy2)), 2);
    assert_eq!(token.balance(&pool_id), 300);

    // The on-chain root must match the root we proved against.
    assert_eq!(
        pool.root().to_array(),
        fr_bytesn(&env, &native_root).to_array()
    );

    // Withdraw to the recipient with the real proof.
    let root_b = fr_bytesn(&env, &native_root);
    let nf_b = fr_bytesn(&env, &nullifier);
    let rsig_b = fr_bytesn(&env, &recipient_field);
    let sproof = to_soroban_proof(&env, &proof);

    assert_eq!(token.balance(&recipient), 0);
    pool.withdraw(&root_b, &nf_b, &recipient, &rsig_b, &sproof);
    assert_eq!(
        token.balance(&recipient),
        100,
        "recipient must receive the denomination"
    );
    assert_eq!(token.balance(&pool_id), 200);

    // Double-spend: the same nullifier must be rejected.
    let retry = pool.try_withdraw(&root_b, &nf_b, &recipient, &rsig_b, &sproof);
    assert!(retry.is_err(), "reusing a nullifier must fail");
    assert_eq!(token.balance(&recipient), 100, "no second payout");
}
