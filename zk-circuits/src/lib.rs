//! Phase 2 vertical slice — a real withdraw circuit for the shielded gift pool.
//!
//! The circuit proves, in zero knowledge, that the prover knows an unspent note
//! sitting in the pool's Merkle tree, and binds the withdrawal to a recipient:
//!
//!   private: secret, and the note's Merkle path (siblings + position bits)
//!   public : root, nullifier, recipient
//!
//! Note scheme (slice-grade; see security note in README):
//!   commitment (leaf) = Poseidon2(secret, 0)
//!   nullifier         = Poseidon2(secret, 1)
//!
//! The nullifier is deterministic per note and revealed on spend (double-spend
//! prevention), while being unlinkable to the commitment (different hash input).
//! `recipient` is a public input the proof commits to, so a front-runner can't
//! re-target a valid withdrawal.

pub mod poseidon2;

use ark_bls12_381::Fr;
use ark_r1cs_std::alloc::AllocVar;
use ark_r1cs_std::boolean::Boolean;
use ark_r1cs_std::eq::EqGadget;
use ark_r1cs_std::fields::fp::FpVar;
use ark_r1cs_std::fields::FieldVar;
use ark_r1cs_std::select::CondSelectGadget;
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};

use poseidon2::{hash2, hash2_var};

/// Tree depth for the slice. Verify cost is depth-independent (Phase 1 spike),
/// so this only affects proving time, not on-chain cost.
pub const DEPTH: usize = 8;

/// The withdraw circuit. `None` fields are for the setup phase (structure only).
#[derive(Clone)]
pub struct WithdrawCircuit {
    // public
    pub root: Option<Fr>,
    pub nullifier: Option<Fr>,
    pub recipient: Option<Fr>,
    // private
    pub secret: Option<Fr>,
    pub siblings: Option<[Fr; DEPTH]>,
    pub index_bits: Option<[bool; DEPTH]>,
}

impl WithdrawCircuit {
    /// Build a fully-assigned instance from a note secret and its position, and
    /// return `(circuit, root, nullifier)` — the root computed natively so the
    /// caller can cross-check and publish it.
    pub fn assign(
        secret: Fr,
        siblings: [Fr; DEPTH],
        index_bits: [bool; DEPTH],
        recipient: Fr,
    ) -> (Self, Fr, Fr) {
        let leaf = hash2(secret, Fr::from(0u64));
        let mut cur = leaf;
        for level in 0..DEPTH {
            cur = if index_bits[level] {
                hash2(siblings[level], cur) // note is the right child
            } else {
                hash2(cur, siblings[level]) // note is the left child
            };
        }
        let root = cur;
        let nullifier = hash2(secret, Fr::from(1u64));
        (
            Self {
                root: Some(root),
                nullifier: Some(nullifier),
                recipient: Some(recipient),
                secret: Some(secret),
                siblings: Some(siblings),
                index_bits: Some(index_bits),
            },
            root,
            nullifier,
        )
    }
}

impl ConstraintSynthesizer<Fr> for WithdrawCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        // Public inputs — order fixed: [root, nullifier, recipient].
        let root = FpVar::new_input(cs.clone(), || {
            self.root.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let nullifier = FpVar::new_input(cs.clone(), || {
            self.nullifier.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let recipient = FpVar::new_input(cs.clone(), || {
            self.recipient.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // Private witnesses.
        let secret = FpVar::new_witness(cs.clone(), || {
            self.secret.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // leaf = Poseidon2(secret, 0)
        let zero = FpVar::constant(Fr::from(0u64));
        let one = FpVar::constant(Fr::from(1u64));
        let mut cur = hash2_var(&secret, &zero)?;

        // Walk up the path.
        for level in 0..DEPTH {
            let sibling = FpVar::new_witness(cs.clone(), || {
                Ok(self.siblings.ok_or(SynthesisError::AssignmentMissing)?[level])
            })?;
            let bit = Boolean::new_witness(cs.clone(), || {
                Ok(self.index_bits.ok_or(SynthesisError::AssignmentMissing)?[level])
            })?;
            // bit = 1 ⇒ note is right child ⇒ left = sibling, right = cur.
            let left = FpVar::conditionally_select(&bit, &sibling, &cur)?;
            let right = FpVar::conditionally_select(&bit, &cur, &sibling)?;
            cur = hash2_var(&left, &right)?;
        }
        cur.enforce_equal(&root)?;

        // nullifier = Poseidon2(secret, 1)
        let nf = hash2_var(&secret, &one)?;
        nf.enforce_equal(&nullifier)?;

        // Bind recipient into the constraint system so the proof is non-malleable
        // w.r.t. it (front-running protection). A single reference is enough.
        let _bound = &recipient * &recipient;

        Ok(())
    }
}
