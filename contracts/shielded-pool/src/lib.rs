#![no_std]

//! Phase 2 — a working fixed-denomination shielded pool for ZK-sealed gift
//! amounts.
//!
//! Deposits and withdrawals both go through the pool without ever revealing
//! which deposit funds which withdrawal, or (within a denomination) any amount:
//!
//! * `deposit(from, commitment)` — pulls the fixed denomination of the pool's
//!   token from `from`, and inserts `commitment` (a Poseidon2 note hash) into an
//!   on-chain incremental Merkle tree. Measured feasible up to depth 8–9 (Phase
//!   1); this pool uses depth 8 (256 notes / denomination).
//! * `withdraw(root, nullifier, recipient, recipient_signal, proof)` — verifies
//!   a Groth16 proof (cross-contract call to the Phase 0 verifier) that the
//!   caller knows an unspent note under a known `root` and derived `nullifier`,
//!   rejects a reused nullifier (double-spend), then pays the recipient.
//!
//! The tree hashing (`poseidon.rs`) and the withdraw circuit's gadget
//! (`zk-circuits`) are the *same* Poseidon2, proven equal, so a note committed
//! on-chain is exactly the note the proof spends.
//!
//! ## ⚠️ Slice-grade — not for value custody without the fixes in README.md
//! Placeholder Poseidon2 constants; single-secret note scheme; per-circuit
//! trusted setup; and the `recipient_signal` ↔ `recipient` binding is enforced
//! cryptographically in the proof but not re-derived in-contract (see README).

mod poseidon;

use groth16_verifier::{Groth16VerifierClient, Proof, VerifyingKey};
use poseidon::{build_params, hash2, Params};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, crypto::bls12_381::Bls12381Fr as Fr,
    token, vec, Address, BytesN, Env, Vec,
};

/// Tree depth. Must equal `zk_circuits::DEPTH`.
const DEPTH: u32 = 8;
/// How many recent roots a withdrawal may prove against.
const ROOT_HISTORY: u32 = 32;

#[contracterror]
#[derive(Clone, Copy)]
pub enum PoolError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    TreeFull = 3,
    UnknownRoot = 4,
    NullifierUsed = 5,
    InvalidProof = 6,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub token: Address,
    pub denom: i128,
    pub verifier: Address,
}

#[contracttype]
pub enum DataKey {
    Config,
    Vk,
    NextIndex,
    Frontier,
    Zeros,
    Roots,
    Nullifier(BytesN<32>),
}

fn zero_bytes(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn to_fr(b: &BytesN<32>) -> Fr {
    Fr::from_bytes(b.clone())
}

fn h2(env: &Env, p: &Params, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    hash2(env, p, &to_fr(a), &to_fr(b)).to_bytes()
}

#[contract]
pub struct ShieldedPool;

#[contractimpl]
impl ShieldedPool {
    /// One-time setup: fix the token, denomination, verifier address, and the
    /// verifying key for the withdraw circuit. Precomputes the empty-subtree
    /// ("zeros") hashes and the initial all-empty root.
    pub fn initialize(env: Env, config: Config, vk: VerifyingKey) {
        let s = env.storage().instance();
        if s.has(&DataKey::Config) {
            panic_err(&env, PoolError::AlreadyInitialized);
        }
        let params = build_params(&env);

        // zeros[0] = 0; zeros[i+1] = H(zeros[i], zeros[i]). Length DEPTH+1.
        let mut zeros: Vec<BytesN<32>> = vec![&env, zero_bytes(&env)];
        for i in 0..DEPTH {
            let z = zeros.get_unchecked(i);
            zeros.push_back(h2(&env, &params, &z, &z));
        }
        // Frontier starts as the zeros of each level (empty left subtrees).
        let mut frontier: Vec<BytesN<32>> = Vec::new(&env);
        for i in 0..DEPTH {
            frontier.push_back(zeros.get_unchecked(i));
        }
        let initial_root = zeros.get_unchecked(DEPTH);

        s.set(&DataKey::Config, &config);
        s.set(&DataKey::Vk, &vk);
        s.set(&DataKey::NextIndex, &0u32);
        s.set(&DataKey::Frontier, &frontier);
        s.set(&DataKey::Zeros, &zeros);
        s.set(&DataKey::Roots, &vec![&env, initial_root]);
    }

    /// Deposit the fixed denomination and insert `commitment` into the tree.
    /// Returns the new leaf index.
    pub fn deposit(env: Env, from: Address, commitment: BytesN<32>) -> u32 {
        from.require_auth();
        let s = env.storage().instance();
        let config: Config = s.get(&DataKey::Config).unwrap_or_else(|| {
            panic_err(&env, PoolError::NotInitialized);
            unreachable!()
        });

        token::TokenClient::new(&env, &config.token).transfer(
            &from,
            &env.current_contract_address(),
            &config.denom,
        );

        let params = build_params(&env);
        let mut index: u32 = s.get(&DataKey::NextIndex).unwrap();
        if index >= 1u32 << DEPTH {
            panic_err(&env, PoolError::TreeFull);
        }
        let leaf_index = index;
        let mut frontier: Vec<BytesN<32>> = s.get(&DataKey::Frontier).unwrap();
        let zeros: Vec<BytesN<32>> = s.get(&DataKey::Zeros).unwrap();

        let mut cur = commitment.clone();
        for i in 0..DEPTH {
            if index & 1 == 0 {
                // Current node is a left child; remember it, sibling is empty.
                frontier.set(i, cur.clone());
                cur = h2(&env, &params, &cur, &zeros.get_unchecked(i));
            } else {
                // Right child; sibling is the stored left subtree.
                cur = h2(&env, &params, &frontier.get_unchecked(i), &cur);
            }
            index >>= 1;
        }

        s.set(&DataKey::NextIndex, &(leaf_index + 1));
        s.set(&DataKey::Frontier, &frontier);

        // Append to bounded root history.
        let mut roots: Vec<BytesN<32>> = s.get(&DataKey::Roots).unwrap();
        roots.push_back(cur.clone());
        while roots.len() > ROOT_HISTORY {
            roots.pop_front();
        }
        s.set(&DataKey::Roots, &roots);

        env.events().publish(
            (soroban_sdk::symbol_short!("deposit"), leaf_index),
            commitment,
        );
        leaf_index
    }

    /// Withdraw the denomination to `recipient`, proving in zero knowledge that
    /// an unspent note exists under a known `root` with this `nullifier`.
    pub fn withdraw(
        env: Env,
        root: BytesN<32>,
        nullifier: BytesN<32>,
        recipient: Address,
        recipient_signal: BytesN<32>,
        proof: Proof,
    ) {
        let s = env.storage().instance();
        let config: Config = s.get(&DataKey::Config).unwrap_or_else(|| {
            panic_err(&env, PoolError::NotInitialized);
            unreachable!()
        });

        // 1. root must be one the pool has produced.
        let roots: Vec<BytesN<32>> = s.get(&DataKey::Roots).unwrap();
        if !roots.iter().any(|r| r == root) {
            panic_err(&env, PoolError::UnknownRoot);
        }

        // 2. nullifier must be unused.
        if s.has(&DataKey::Nullifier(nullifier.clone())) {
            panic_err(&env, PoolError::NullifierUsed);
        }

        // 3. verify the Groth16 proof via the Phase 0 verifier (public inputs in
        //    the circuit's fixed order: root, nullifier, recipient_signal).
        let vk: VerifyingKey = s.get(&DataKey::Vk).unwrap();
        let signals = vec![&env, root, nullifier.clone(), recipient_signal];
        let ok = Groth16VerifierClient::new(&env, &config.verifier).verify(&vk, &proof, &signals);
        if !ok {
            panic_err(&env, PoolError::InvalidProof);
        }

        // 4. effects before interaction: burn the nullifier, then pay out.
        s.set(&DataKey::Nullifier(nullifier.clone()), &true);
        token::TokenClient::new(&env, &config.token).transfer(
            &env.current_contract_address(),
            &recipient,
            &config.denom,
        );

        env.events()
            .publish((soroban_sdk::symbol_short!("withdraw"),), nullifier);
    }

    /// Current Merkle root (most recent).
    pub fn root(env: Env) -> BytesN<32> {
        let roots: Vec<BytesN<32>> =
            env.storage().instance().get(&DataKey::Roots).unwrap();
        roots.get_unchecked(roots.len() - 1)
    }

    /// Number of notes deposited so far.
    pub fn next_index(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::NextIndex).unwrap()
    }

    /// 2-to-1 Poseidon2 compression — exposed for the cross-check test.
    pub fn hash(env: Env, a: BytesN<32>, b: BytesN<32>) -> BytesN<32> {
        let params = build_params(&env);
        hash2(&env, &params, &Fr::from_bytes(a), &Fr::from_bytes(b)).to_bytes()
    }
}

fn panic_err(env: &Env, e: PoolError) {
    soroban_sdk::panic_with_error!(env, e);
}

#[cfg(test)]
mod test;
