# shielded-pool — confidential gift pool (Phases 1 → 2)

> **Phase 2 status: the pool is built and working end-to-end.** `deposit` inserts
> a Poseidon2 note commitment into an on-chain incremental Merkle tree; `withdraw`
> verifies a Groth16 proof (cross-contract call to the Phase 0 verifier) that an
> unspent note exists under a known root, rejects reused nullifiers, and pays the
> recipient from fixed-denomination custody. The native test
> `deposit_withdraw_end_to_end_and_double_spend_rejected` drives the whole flow
> with a **real** proof generated from `zk-circuits` against the exact tree the
> pool builds on-chain; the deployed pool's Poseidon2 matches that circuit's
> gadget byte-for-byte on testnet (`hash(7,11)` = `64b9189d…c6a3` both places).
>
> Deployed pool (testnet): `CDDF4SNZ6LRAZURFG37SAZQBDHD4S6DTOIQVAQZMLREIQNU2V77RXGS6`
> · verifier: `CBL4G6ER53DV5MJY72FAB2DJKBUSWSZEXGCA3ZGI4YTZHK2UH66LML43`
>
> **Live end-to-end on testnet (2026-07-19):** pool initialized (XLM, 10-XLM denom,
> matching vk) → deposit of a real note (tx `5b0cba78…`, 10 XLM locked) → backend
> indexer served the leaf → browser wasm rebuilt the auth path whose root **matched
> the on-chain root** (`0258d352…`) → withdraw with that proof (tx `2d000582…`)
> paid the recipient exactly 10 XLM (balance 10000 → 10010), amount never on-chain.
> Re-submitting the spent nullifier is rejected. Every component was the real
> browser code path; only Freighter signing was substituted with CLI signing.
>
> ⚠️ Slice-grade — see "Security notes". Not for value custody until those are
> addressed and the code is audited.

The rest of this document records the Phase 1 measurements that shaped the design.

---

# Phase 1 foundation (how we got here)

Phase 0 proved a Groth16 proof can be *verified* on-chain for ~47M instructions.
Phase 1 tackles the other half of a shielded pool: the **deposit**, which means
inserting a note commitment into an incremental Merkle tree — and that requires
computing **Poseidon** on-chain over BLS12-381 via the `fr_*` host functions.

This crate builds those deposit-side primitives (Poseidon2 hash + Merkle
insertion) and, most importantly, **measures them on real testnet**. The headline
result changed the Phase 1 design.

## What was built

- `src/poseidon.rs` — a width-3 **Poseidon2** permutation (2-to-1 compression)
  using only `fr_add` / `fr_mul` / `fr_pow` host calls.
- `src/lib.rs` — `hash(a,b)` and `insert(leaf, depth)` (the per-deposit hashing
  work: `depth` Poseidon hashes up a path).
- `src/test.rs` — an **independent arkworks field-arithmetic mirror** that
  reproduces the on-chain hash bit-for-bit (proves the host arithmetic is
  correct), plus the cost report.

Correctness: the on-chain Poseidon2 matches the native mirror for every tested
input. ✅

## Headline result: naive on-chain insertion does **not** scale

Measured on testnet (contract `CCYLNL5ZKAHL6OL6N7L7MHDF7DYU64ULRDPW3GGTDTF46AZNGNF6TLE3`):

| Deposit tree depth | On-chain instructions | Status |
|---|---|---|
| 8 (256 leaves) | 84,150,212 | SUCCESS |
| 9 (512 leaves) | 94,522,905 | SUCCESS |
| 16 (65k leaves) | 167,131,754 | over 100M budget |

- **Real cost per Poseidon hash ≈ 10.4M instructions** (linear: `~1.2M + depth·10.4M`).
- Against the portable **100M** per-transaction budget, a naive deposit caps out
  at **~depth 9 — about 512 gifts per denomination**. Too small for production.

### Two things this measurement taught us

1. **Poseidon2 was essential but not sufficient.** Classic Poseidon cost ~11.9M
   *native* per hash (585 `fr_mul` in the MDS layer). Switching to Poseidon2
   (multiplication-free external rounds, 3-mul internal rounds) cut it to ~5.8M
   native. Good, but…
2. **Native metering badly underestimates this workload.** Phase 0's single big
   `pairing_check` metered almost identically native-vs-chain. Here the work is
   *hundreds of tiny host calls per hash*, and the wasm glue between them (loop
   control, `Val` marshalling, `Vec` access) is what native misses: 5.8M native
   → 10.4M on-chain, ~1.8×. **Lesson: micro-op-heavy contract code must be
   measured on-chain, never trusted from native tests.**

## The Phase 1 pivot: proof-based deposits

Computing the tree insertion *on-chain* is the wrong primitive on Soroban — each
Poseidon hash is ~10M instructions, so any usefully-deep tree blows the budget.
The scalable design moves the hashing **off-chain and into a proof**:

- The depositor computes the new Merkle root locally and submits a **ZK proof**
  that the new root correctly appends their commitment to the previous frontier.
- On-chain, the contract **verifies one Groth16 proof (~47M, Phase 0)** and stores
  the new root — flat cost, **independent of tree depth**. Depth can be 32+.

This makes *both* deposit and withdraw ~47M verify operations and unifies them on
the Phase 0 verifier. Trade-off: depositors now generate a proof (heavier client
UX), and deposits must be sequenced (or prove append against a stored frontier)
to avoid concurrent-root races. The alternative — keeping on-chain hashing —
would force either a tiny pool (depth ≤ 9) or many sharded pools, both worse.

**Recommendation:** adopt proof-based deposits for Phase 1 proper.

### Spike result — proof-based deposit cost is flat and cheap ✅

Measured against the deployed Phase 0 verifier (`CBL4G6ER…ML43`), verifying a
proof as a function of public-input count:

| Public inputs | On-chain instructions |
|---|---|
| 1 (Phase 0 baseline) | 47,297,357 |
| **3 (old root, new root, commitment)** | **50,404,746** (SUCCESS) |

Each extra public input adds ~1.5M (one MSM term). A deposit-shaped 3-input proof
verifies for **~50.4M — half the budget — and this does not grow with tree
depth.** So proof-based deposits make a depth-32 tree (4 billion notes) exactly as
cheap to deposit into as a depth-8 one, versus the naive approach's hard ceiling
at depth ~9 (512 notes). The architecture is settled: **both deposit and withdraw
are ~50M Groth16 verifies.** Fixture emitter: `groth16-verifier`’s
`emit_deposit_fixture` test.

## The pool (Phase 2)

`initialize(config, vk)` → `deposit(from, commitment)` → `withdraw(root,
nullifier, recipient, recipient_signal, proof)`. Deposit cost is the Phase 1
insertion (~84M at depth 8, authoritative); withdraw is a single Groth16 verify
via CPI to the Phase 0 verifier (~50M, Phase 2 slice). Depth is 8 (256 notes per
denomination) — the ceiling on-chain insertion allows within budget.

```bash
cargo test -p shielded-pool          # end-to-end: deposit→withdraw→double-spend-rejected
```

## ⚠️ Security notes (must address before value custody)

1. **Placeholder Poseidon2 constants** (`ark[k]=k+1`, `diag=[2,3,4]`) — identical
   in `poseidon.rs`, the `zk-circuits` gadget, and its native mirror. Regenerate
   all three together from a standard nothing-up-my-sleeve procedure.
2. **Recipient binding** — the proof commits to `recipient_signal` (non-malleable,
   proven on-chain in the Phase 2 slice), but the contract does not re-derive that
   signal from the `recipient` Address. Production must bind them in-contract (host
   hash of the address) so a valid proof cannot be re-pointed at another address.
3. **Slice-grade note scheme** — one `secret` derives both commitment and
   nullifier; production should split spending/nullifier keys and bind
   amount+asset into the commitment.
4. **Trusted setup** — per-circuit Groth16 setup with a test RNG; needs a real
   ceremony (or a universal-setup scheme).
5. **Not audited.**

## Reproduce (Phase 1 cost bench, historical)

The depth-vs-cost figures above came from a standalone insertion bench; the code
now carries the full pool. To re-measure raw insertion cost, check out the Phase 1
`insert(leaf, depth)` method from history.
