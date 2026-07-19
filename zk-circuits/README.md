# zk-circuits — Phase 2 vertical slice (ZK-sealed gift amounts)

Phase 0 proved a Groth16 proof verifies on-chain (~47M). Phase 1 settled the pool
architecture: deposit and withdraw are both ~50M proof verifications, tree-depth
independent. Phase 2 builds the **first real circuit** and proves the two hardest
unknowns are solved:

1. a ZK circuit's Poseidon hash can be made to **match the contract's Poseidon
   byte-for-byte**, so a commitment created on-chain satisfies an off-chain proof;
2. a **real withdraw proof** (Merkle membership + nullifier + recipient binding)
   verifies on the deployed on-chain verifier, at the cost Phase 1 predicted.

Both are now demonstrated end-to-end on testnet.

This crate is native-only (proof generation + trusted setup). It lives outside
the soroban `contracts/` workspace because it never compiles to wasm.

## What was built

- `src/poseidon2.rs` — Poseidon2 in **two forms that are tested equal**: a native
  `hash2` (witness computation) and an R1CS gadget `hash2_var` (in-circuit). Both
  mirror `contracts/shielded-pool/src/poseidon.rs` exactly.
- `src/lib.rs` — `WithdrawCircuit`: proves knowledge of an unspent note in the
  pool's Merkle tree and binds the spend to a recipient.
  - private: `secret`, Merkle path (siblings + position bits)
  - public: `root`, `nullifier`, `recipient`
  - note scheme: `commitment = Poseidon2(secret, 0)`, `nullifier = Poseidon2(secret, 1)`
- `tests/withdraw.rs` — proves the circuit, cross-checks natively, asserts a
  substituted recipient is rejected, and emits a Soroban-format fixture.

## Results (all verified on real testnet)

Against the deployed Phase 0 verifier `CBL4G6ER…ML43`:

| Check | Result |
|---|---|
| Gadget Poseidon2 == native Poseidon2 | ✅ equal for all tested inputs |
| Withdraw proof — native verify | ✅ valid |
| Withdraw proof — **on-chain verify** | ✅ **SUCCESS, 50,407,319 instructions** |
| Substituted recipient — native | ✅ rejected |
| Substituted recipient — **on-chain** | ✅ **returns `false`** |

- On-chain withdraw verify (**50.4M**, 3 public inputs) matches the Phase 1 spike
  prediction (50.4M) to within noise, and uses ~half the 100M budget.
- Front-running protection is real and enforced *on-chain*: a valid proof cannot
  be re-pointed at a different recipient.
- Verify TX: `0a160b318ac8fd26a16e8816dc0821e979e2a8d56b2fa05f7fe49ba7fe4aafb9`

## What this de-risks

The scariest part of the whole design — "will an off-chain circuit's hash ever
actually agree with the on-chain contract's hash, and will the resulting proof
verify within budget?" — is now answered **yes**, with a working artifact. The
remaining Phase 2 work is engineering on a proven foundation, not research.

## Reproduce

```bash
cargo test -p zk-circuits            # gadget==native, proof valid, fixture emitted
                                     # -> target/phase2-fixture/{vk,proof,signals}.json
CID=CBL4G6ER53DV5MJY72FAB2DJKBUSWSZEXGCA3ZGI4YTZHK2UH66LML43
cd target/phase2-fixture
stellar contract invoke --id $CID --source deployer --network testnet --send=yes -- verify \
  --vk "$(cat vk.json)" --proof "$(cat proof.json)" --signals "$(cat signals.json)"   # => true
```

## Phase 2 status

✅ **Withdraw circuit + on-chain verification** (this crate) — done.
✅ **Pool contract** (`contracts/shielded-pool`) — done: on-chain incremental
   Merkle insertion for deposit, cross-contract Groth16 verification for withdraw,
   nullifier double-spend prevention, bounded root history, and fixed-denomination
   token custody. A native end-to-end test proves **deposit → withdraw →
   double-spend-rejected** with a real proof against the tree the pool builds
   on-chain, and the deployed pool's Poseidon2 matches this gadget byte-for-byte
   on testnet. See `contracts/shielded-pool/README.md`.

The pool uses **on-chain insertion** (feasible at depth 8, Phase 1), so a separate
deposit *circuit* is not required for this design. The proof-based-deposit
alternative (documented in the Phase 1 README) remains the upgrade path for
trees deeper than ~depth 9.

### Remaining before this is a shippable product

**Frontend / client integration** is the one piece left, and it's substantial:
note generation, claim-link carrying the note secret, **browser-side proof
generation (wasm)**, and the "🔒 Seal amount" vs "Send openly" toggle in the
sender wizard. Plus every item under "Security notes" below. None of it is
research — the cryptography and contract mechanics are proven end-to-end.

## ⚠️ Security notes (do not ship without addressing)

- **Poseidon2 constants are a deterministic PLACEHOLDER** (`ark[k]=k+1`,
  `diag=[2,3,4]`), identical in the contract, the native mirror, and the gadget.
  Regenerate all three from a standard nothing-up-my-sleeve procedure together.
- **Note scheme is slice-grade**: a single `secret` derives both commitment and
  nullifier. Production should separate a spending key from a nullifier key and
  bind the amount/asset into the commitment.
- **Trusted setup**: this uses a per-circuit Groth16 setup with a test RNG. A real
  deployment needs a proper ceremony (or a universal-setup scheme).
- **Not audited.** This is a feasibility slice; the value-custody path must be
  audited before mainnet.
