# 🎁 Giffy — Send Crypto as a Gift Link, with an Optional Zero-Knowledge Seal

<div align="center">
<img src="https://img.shields.io/badge/Stellar-Soroban-7B2FBE?style=for-the-badge" />
<img src="https://img.shields.io/badge/Rust-1.95-red?style=for-the-badge" />
<img src="https://img.shields.io/badge/Next.js-15-black?style=for-the-badge" />
<img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge" />
<img src="https://img.shields.io/badge/Groth16-BLS12--381-blueviolet?style=for-the-badge" />
<img src="https://img.shields.io/badge/Status-Live%20on%20Testnet-brightgreen?style=for-the-badge" />

**Send crypto the way you'd send an e-gift card — a link, a message, and a claim button. Every gift lives inside one Soroban contract from creation through claim or refund. Optionally, the amount itself never touches the chain in the clear: it's sealed into a zero-knowledge shielded pool and proven, not revealed, at claim time.**

</div>

---

## 🚀 Deployed Contracts (Stellar Testnet)

**Network:** Stellar Testnet · Passphrase `Test SDF Network ; September 2015`

**Deployer:** `GAL6ZVVRE2RPFS2X23I65QANHHIBGHKTGGVIT5AJURRKTIMEVUMJJUZZ`

| Contract | Deployed Address (testnet) | Explorer |
|---|---|---|
| **gift-escrow** (main gift contract) | `CCABIQYBL53CPLZLXCDNG4TQ54RUCWHZJXFLCROETVU3LGGXQZXZUWT4` | [view](https://stellar.expert/explorer/testnet/contract/CCABIQYBL53CPLZLXCDNG4TQ54RUCWHZJXFLCROETVU3LGGXQZXZUWT4) |
| **groth16-verifier** (ZK proof verifier) | `CBL4G6ER53DV5MJY72FAB2DJKBUSWSZEXGCA3ZGI4YTZHK2UH66LML43` | [view](https://stellar.expert/explorer/testnet/contract/CBL4G6ER53DV5MJY72FAB2DJKBUSWSZEXGCA3ZGI4YTZHK2UH66LML43) |
| **shielded-pool** (confidential gift pool) | `CDDF4SNZ6LRAZURFG37SAZQBDHD4S6DTOIQVAQZMLREIQNU2V77RXGS6` | [view](https://stellar.expert/explorer/testnet/contract/CDDF4SNZ6LRAZURFG37SAZQBDHD4S6DTOIQVAQZMLREIQNU2V77RXGS6) |
| XLM (Stellar Asset Contract) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | [view](https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) |
| USDC (testnet, via reference anchor) | issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | — |

> The shielded pool is initialized for **XLM at a fixed 10-XLM denomination**, using the SAC above and the deployed `groth16-verifier` as its proof verifier.

### Smart-contract folder structure

```
contracts/
├── Cargo.toml                 # Rust workspace (gift-escrow, groth16-verifier, shielded-pool)
├── gift-escrow/src/
│   ├── lib.rs                 # create_gift, contribute, unlock_step, claim, refund, get_gift
│   ├── types.rs  storage.rs  errors.rs
│   └── test.rs                # 8 integration tests (soroban_sdk::testutils)
├── groth16-verifier/src/
│   ├── lib.rs                 # verify(vk, proof, signals) — Groth16 over BLS12-381 host functions
│   └── test.rs                # real arkworks-generated proofs, verified on-chain + budget report
└── shielded-pool/src/
    ├── lib.rs                 # initialize, deposit, withdraw, root, next_index
    ├── poseidon.rs             # on-chain Poseidon2 hash (2-to-1 compression, BLS12-381 scalar field)
    └── test.rs                 # end-to-end deposit → withdraw → double-spend-rejected

zk-circuits/                   # native Rust: the withdraw circuit (Merkle membership + nullifier)
zk-prover-wasm/                # the same circuit compiled to wasm — runs in the browser
```

### Contract ↔ frontend function mapping

| Contract fn (Rust) | Frontend caller (TypeScript) |
|---|---|
| `gift-escrow.create_gift` / `contribute` / `unlock_step` / `claim` / `refund` | `chain/src/giftEscrow.ts` ← `backend/src/services/giftService.ts` / `claimService.ts` / `conditionService.ts` ← `frontend/src/hooks/useGift.ts` / `useClaim.ts` / `useCondition.ts` |
| `gift-escrow.get_gift` | `backend/src/services/reconciliationService.ts` (re-reads and overwrites the Mongo cache after every state-changing call) |
| `shielded-pool.deposit` | `chain/src/shieldedPool.ts::buildPoolDepositTx` ← `backend/src/services/poolService.ts` ← `frontend/src/hooks/useSealedDeposit.ts` |
| `shielded-pool.withdraw` | `chain/src/shieldedPool.ts::buildPoolWithdrawTx` ← `poolService.ts` ← `frontend/src/hooks/useSealedClaim.ts` |
| `shielded-pool.root` / `next_index` | Merkle-path reconstruction cross-check (`frontend/src/lib/merkleTree.ts`) |
| `groth16-verifier.verify` | called **cross-contract**, from inside `shielded-pool.withdraw` — never invoked directly by the frontend |

Contract IDs are wired through `backend/.env` (`GIFT_ESCROW_CONTRACT_ID`, `SHIELDED_POOL_CONTRACT_ID`) and `frontend/.env.local` (`NEXT_PUBLIC_GIFT_ESCROW_CONTRACT_ID`). Full evidence with tx-hash links: [§25 Deployment Evidence](#25-deployment-evidence).

### CI/CD

There is currently **no CI/CD pipeline configured** for this repository (no `.github/workflows/`, and the project directory is not yet a git repository). All test/typecheck/build commands below are run manually; see [§21](#21-cicd-pipeline) for exactly what a CI pipeline should run once one is added.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Why Everything Goes Through One Contract](#2-why-everything-goes-through-one-contract)
3. [Problem Statement & Motivation](#3-problem-statement--motivation)
4. [Deep Dive: The `gift-escrow` Contract](#4-deep-dive-the-gift-escrow-contract)
5. [Deep Dive: Zero-Knowledge Sealed Gifts](#5-deep-dive-zero-knowledge-sealed-gifts)
6. [The Trustline Tradeoff](#6-the-trustline-tradeoff)
7. [End-to-End User Flows](#7-end-to-end-user-flows)
8. [Full System Architecture](#8-full-system-architecture)
9. [Repository Structure](#9-repository-structure)
10. [Contract Layer](#10-contract-layer)
11. [Chain Layer (`/chain`)](#11-chain-layer-chain)
12. [Backend (`/backend`)](#12-backend-backend)
13. [Frontend (`/frontend`)](#13-frontend-frontend)
14. [Data Models (MongoDB)](#14-data-models-mongodb)
15. [API Reference](#15-api-reference)
16. [State Machines](#16-state-machines)
17. [Security Considerations](#17-security-considerations)
18. [Wallet Integration (Freighter)](#18-wallet-integration-freighter)
19. [XLM / USDC / Sealed-Pool Testnet Setup](#19-xlm--usdc--sealed-pool-testnet-setup)
20. [Testing — Run & Outputs](#20-testing--run--outputs)
21. [CI/CD Pipeline](#21-cicd-pipeline)
22. [Deployment & Rollback](#22-deployment--rollback)
23. [Environment Variables](#23-environment-variables)
24. [Troubleshooting](#24-troubleshooting)
25. [Deployment Evidence](#25-deployment-evidence)
26. [Known Limitations & Roadmap](#26-known-limitations--roadmap)

---

## Quick Links

| Resource | Link |
|---|---|
| Local frontend | `http://localhost:3000` (see [§19](#19-xlm--usdc--sealed-pool-testnet-setup) / [§22](#22-deployment--rollback)) |
| Local backend API | `http://localhost:4000/api` |
| gift-escrow explorer | [stellar.expert](https://stellar.expert/explorer/testnet/contract/CCABIQYBL53CPLZLXCDNG4TQ54RUCWHZJXFLCROETVU3LGGXQZXZUWT4) |
| shielded-pool explorer | [stellar.expert](https://stellar.expert/explorer/testnet/contract/CDDF4SNZ6LRAZURFG37SAZQBDHD4S6DTOIQVAQZMLREIQNU2V77RXGS6) |

---

## 1. Project Overview

Giffy is a non-custodial application for sending crypto as a shareable gift link, built around a single Soroban smart contract called `gift-escrow`. Every gift Giffy creates — no exceptions — is a record inside this contract: a pooled balance, a list of contributors, an expiry, a designated receiver, and an optional claim condition. A "simple" gift (one sender, no condition) isn't a separate code path; it's the general case with the optional parts unused.

On top of that base, Giffy adds a second, independent capability: **sealed gifts**. A sender can choose to lock the gift amount into a **confidential shielded pool** instead of the open `gift-escrow` contract. The amount never appears on-chain in the clear — not in the deposit transaction, not in the contract's storage, not at withdrawal. The receiver claims by generating a **zero-knowledge proof in their own browser** that they hold an unspent note, without revealing which note or how much it's worth.

### What This Project Builds

| Page | What it does |
|---|---|
| **`/create`** | Compose a gift: asset, amount, message, theme, expiry, optional group contribution, optional claim condition (trivia / step-gate), and the **"🔒 Seal the amount"** toggle. |
| **`/claim/[token]`** | Ordinary (unsealed) gift claim: preview, condition check, trustline, claim into wallet. |
| **`/claim/sealed`** | Sealed-gift claim: reads a note secret from the URL fragment, proves the withdrawal in-browser (~3 s), submits — amount never shown, never on-chain. |
| **`/gift/[id]/contribute`** | Group-gift contribution link, separate from the claim link. |
| **`/dashboard`** | The sender's own gifts: status, refund, step-unlock actions. |

### Target Environment

| Setting | Value |
|---|---|
| Network | Stellar Testnet |
| Smart Contract VM | Soroban (WASM), `soroban-sdk` 27.0.0 |
| Contract Language | Rust 1.95 |
| ZK proof system | Groth16 over BLS12-381 (verified via Soroban's Protocol-22 BLS host functions) |
| Token pair | XLM (native) / testnet USDC |
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript 5.7 |
| Backend | Express 5 + Mongoose 8 (MongoDB) |
| Wallet | Freighter (browser extension) |

---

## 2. Why Everything Goes Through One Contract

### 2.1 What a dual-mode system would have cost

An earlier design considered classic Claimable Balances for simple gifts and a contract only for group/conditional gifts. That was rejected: maintaining two parallel mechanics for one product feature (a gift that sits until claimed) means two sets of chain-layer code, two branches through every backend service, two claim-transaction code paths on the frontend, and two things to reason about security-wise — for zero benefit to the simple case, which behaves identically to the user either way.

### 2.2 What "everything through the contract" buys instead

- **One mental model.** A gift is a `GiftRecord`. It always has contributors (at least one), always has an expiry, always has a condition (which may be `None`).
- **One code path per action** — `create_gift`, `contribute`, `claim`, `refund`, `unlock_step` each have exactly one implementation across `/chain`, `/backend`, `/frontend`.
- **Room to grow without a rewrite** — group contributions and conditions are switches on the same primitive, not migrations.

### 2.3 What it costs, honestly

- Every gift costs a Soroban invocation fee, not a cheaper classic operation fee — negligible on testnet.
- Trustline setup can't be batched into the same transaction as a gift's creation or claim (Section 6).
- `gift-escrow` becomes the single most security-critical piece of the whole system.

The same logic extends to the sealed-gift feature: rather than bolting confidentiality onto `gift-escrow` as a per-gift flag (which the ledger would still leak through the deposit transaction amount), it's a **structurally separate pool contract** — because true amount privacy requires a shared anonymity set, not a flag on an individually-visible escrow record. See [Section 5](#5-deep-dive-zero-knowledge-sealed-gifts).

---

## 3. Problem Statement & Motivation

Sending someone crypto today generally requires the sender to already know the receiver's wallet address, and requires the receiver to already have a wallet capable of receiving that specific asset. Giffy inverts the model: the sender locks funds into a themed, shareable link the moment they decide to send a gift, and the receiver connects a wallet only at claim time. Because the mechanism is time-bound and refundable by construction, an unclaimed gift doesn't strand funds — it becomes reclaimable after expiry, automatically.

Three extensions make the product richer without changing its fundamental shape:

- **Group gifting** — several people contributing to one link.
- **Conditional claims** — a trivia question or a staged multi-step unlock, turning a transfer into a small experience.
- **Sealed gifts (new)** — some senders don't want the amount visible to a chain explorer, a nosy contact, or the receiver's other contacts. Sealing removes that leak entirely, at the cost of a fixed denomination and a heavier (browser-proving) claim flow.

---

## 4. Deep Dive: The `gift-escrow` Contract

### 4.1 What the Contract Represents

Every gift is one `GiftRecord`, keyed by an auto-incrementing `u64` id the contract assigns. The same struct and claim logic apply whether a gift has one contributor and no condition, or five contributors and a trivia question.

```rust
pub struct GiftRecord {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub contributions: Map<Address, i128>,
    pub expires_at: u64,
    pub status: GiftStatus,          // Open | Claimed | Refunded
    pub condition: ClaimCondition,   // None | AnswerHash(BytesN<32>) | StepGate(u32)
    pub steps_completed: u32,
    pub step_unlocker: Address,
    pub message_hash: BytesN<32>,
}
```

### 4.2 Contract Functions (`contracts/gift-escrow/src/lib.rs`)

| Function | Auth | Behavior |
|---|---|---|
| `create_gift(sender, receiver, token, initial_amount, expires_at, condition, step_unlocker, message_hash) -> u64` | `sender` | Validates amount/expiry, transfers `initial_amount` into the contract, persists a new `Open` record, returns the id. |
| `contribute(contributor, gift_id, amount)` | `contributor` | Requires `Open` + unexpired; transfers `amount` in; updates `total_amount` and the per-contributor map. No on-chain gate on *who* may contribute — see [§17](#17-security-considerations). |
| `unlock_step(unlocker, gift_id)` | `unlocker == gift.step_unlocker` | Increments `steps_completed` for a step-gated gift. |
| `claim(gift_id, claimant, answer: Option<Bytes>)` | `claimant == gift.receiver` | Requires `Open` + unexpired; evaluates the condition (`AnswerHash` compares `sha256(answer)` to the stored hash; `StepGate` requires all steps done); **state updated before the external transfer** (checks-effects-interactions); transfers `total_amount` to the claimant. |
| `refund(gift_id, caller)` | `caller` is sender or any contributor | Requires `Open` + expired; refunds each contributor their own recorded amount, pro-rata. |
| `get_gift(gift_id) -> GiftRecord` | none (read-only) | Used by the backend's reconciliation sweep to overwrite its cache with authoritative on-chain state. |

### 4.3 Errors (`contracts/gift-escrow/src/errors.rs`)

```rust
pub enum GiftEscrowError {
    GiftNotFound = 1, GiftNotOpen = 2, GiftExpired = 3, GiftNotYetExpired = 4,
    NotReceiver = 5, WrongAnswer = 6, StepsNotComplete = 7, NotAuthorizedUnlocker = 8,
    AllStepsAlreadyComplete = 9, InvalidContributionAmount = 10, InvalidExpiry = 11,
    NotStepGated = 12, NotSenderOrContributor = 13,
}
```

Every panic uses `panic_with_error!`, so `chain/src/errors.ts::parseContractError` maps every failure to a specific, human-readable message end to end.

### 4.4 Token Transfer and the Soroban Auth Framework

Every fund-moving function calls the relevant Stellar Asset Contract's `transfer` cross-contract, rather than keeping an internal ledger. Because Soroban requires explicit authorization for every nested contract invocation, the transaction the frontend signs must authorize **both** the `gift-escrow` call and the nested token `transfer`. `chain/src/sorobanClient.ts::buildAndSimulate` always simulates first — that's what resolves the full authorization tree — and never constructs it by hand.

### 4.5 Tests (`contracts/gift-escrow/src/test.rs`)

8 integration tests, run with `soroban_sdk::testutils`: create+claim (no condition), trivia correct/incorrect, step-gate blocking, contribution totals, refund pro-rata, expiry gating. All 8 pass — see [§20](#20-testing--run--outputs).

---

## 5. Deep Dive: Zero-Knowledge Sealed Gifts

This is the newest and most involved part of Giffy: a **confidential shielded pool** that lets a sender lock a gift amount without it ever appearing on-chain in the clear, and lets the receiver claim it with a zero-knowledge proof generated **in their own browser**. This section documents the cryptography, the contracts, the browser prover, the deposit indexer, and the real end-to-end run that proved all of it works together on live testnet.

### 5.1 Why a flag on `gift-escrow` can't do this

Amounts can only be hidden **inside** a shared anonymity set. Every time value crosses the boundary between the public ledger and a shielded pool, that crossing reveals a number — a deposit transaction's amount is visible on Stellar regardless of what any contract does with it internally. So "hide the amount" precisely means: **many senders deposit into one shared pool, and a gift is a secret note inside it, not an individually visible escrow record.** This is why sealed gifts are a structurally separate contract (`shielded-pool`), not a boolean on `gift-escrow`.

### 5.2 The cryptographic design

**Note scheme:** a sealed gift is a *note* — `(secret)`, from which:
- **commitment** (the public, on-chain leaf) = `Poseidon2(secret, 0)`
- **nullifier** (revealed only at spend time, prevents double-claims) = `Poseidon2(secret, 1)`

**Deposit:** the sender's wallet locks the pool's fixed denomination (10 XLM on this testnet deployment) and the pool contract inserts the commitment into an **on-chain incremental Merkle tree** (depth 8 → 256 notes per denomination).

**Withdraw:** the receiver proves, via a **Groth16 zk-SNARK**, that they know a secret whose commitment sits in the tree under a known root, and whose nullifier is the one being published — without revealing the secret, which leaf it was, or (since every note in the pool is the same fixed denomination) anything about the value beyond "one denomination's worth." The pool contract verifies this proof **cross-contract**, against a separately deployed, generic Groth16 verifier.

**Proof system:** Groth16 over the **BLS12-381** curve, chosen specifically because Soroban's Protocol-22 upgrade exposes BLS12-381 field/curve arithmetic (`g1_msm`, `g1_mul`, `pairing_check`, `fr_add`/`fr_mul`/`fr_pow`, …) as native host functions — making on-chain pairing-based proof verification computationally practical for the first time on this chain.

### 5.3 The three Rust crates

| Crate | Role | Compiles to |
|---|---|---|
| `contracts/groth16-verifier` | Generic on-chain Groth16 verifier: `verify(vk, proof, signals) -> bool`, implementing `e(-A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) == 1` as one `pairing_check` over 4 pairs. | Soroban wasm (2,915 bytes) |
| `contracts/shielded-pool` | `initialize`, `deposit` (Poseidon2 tree insertion + token custody), `withdraw` (nullifier check + cross-contract verify + payout), `root`, `next_index`. Contains `poseidon.rs`, an on-chain **Poseidon2** hash built entirely from BLS12-381 `fr_*` host calls. | Soroban wasm (12,188 bytes) |
| `zk-circuits` | The withdraw **circuit** (arkworks `ConstraintSynthesizer`): Merkle-membership + nullifier derivation + recipient binding. Its Poseidon2 gadget is tested bit-for-bit equal to the on-chain hash. | native only (proving/trusted-setup code, never wasm) |
| `zk-prover-wasm` | Wraps the withdraw circuit with `wasm-bindgen` so a full Groth16 proof can be generated **in the browser**, from a `wasm32` build. | browser wasm (468 KB) |

### 5.4 Why Groth16 verification is affordable on-chain — the numbers

This was measured, not assumed, in three stages against Soroban's **100,000,000 CPU-instruction** per-transaction budget:

| Measurement | On-chain instructions | % of budget |
|---|---|---|
| Groth16 verify, 1 public input (baseline) | 47,297,357 | 47% |
| Groth16 verify, 3 public inputs (deposit-shaped) | 50,404,746 | 50% |
| **Real withdraw proof verify (3 inputs: root, nullifier, recipient signal)** | **50,407,319** | **50%** |
| Naive on-chain Merkle insertion, depth 8 (256 leaves) | 84,150,212 | 84% |
| Naive on-chain Merkle insertion, depth 9 (512 leaves) | 94,522,905 | 95% |
| Naive on-chain Merkle insertion, depth 16 — **fails** | 167,131,754 | 167% ❌ |

Two findings fell out of this:
1. **Verify cost is flat regardless of circuit size** — only the *number of public inputs* moves the cost (each adds ~1.5M via one extra elliptic-curve multi-scalar-multiplication term), because a Groth16 verification is always the same fixed 4-pairing check no matter how large the underlying circuit's constraint system is.
2. **Naive on-chain Merkle hashing does not scale** on Soroban — Poseidon2 was chosen specifically because classic Poseidon cost ~11.9M native instructions per hash (585 field multiplications in its MDS mixing layer); switching to Poseidon2's near-multiplication-free external rounds cut that to ~5.8M native / ~10.4M on-chain per hash. Even so, a tree past depth ~9 blows the budget. This pool's depth-8 on-chain insertion sits right under that ceiling; a deeper pool would need to move insertion into a second, proof-based circuit (documented as the scale-up path in `contracts/shielded-pool/README.md`) rather than hashing on-chain.

### 5.5 The browser prover — cost and correctness

| Metric | Value |
|---|---|
| Circuit constraints | 2,457 |
| Proving key (compressed) | 770 KB — fetched once by the browser, cacheable |
| Wasm module | 468 KB |
| Verifying key | 536 bytes |
| Proof size | 192 bytes (Groth16, fixed) |
| Native prove time | ~88–228 ms |
| **Browser (wasm) prove time** | **~2.9 s**, single-threaded |

A proof generated by the wasm module was verified against the deployed on-chain verifier and returned `true`; a proof with a substituted recipient returned `false` — proving both correctness (the intended proof passes) and soundness (an attacker cannot re-target the payout) **on-chain**, not just in a native test.

### 5.6 The deposit indexer

To withdraw, the browser needs the note's Merkle **authentication path**, which requires knowing every commitment ever deposited, in order. `backend/src/services/poolIndexerService.ts` polls `shielded-pool`'s `deposit` events (`chain/src/shieldedPool.ts::getPoolDepositEvents`) every minute (`poolIndexerCron.ts`), caches them in the `PoolLeaf` collection (unique on `poolId+leafIndex`, so re-scans are idempotent), and serves them at `GET /api/pool/leaves`. A successful deposit submission also triggers an immediate sync, so a freshly deposited note is claimable without waiting for the next poll. `getOrderedCommitments` refuses to serve a list with a gap (`0..n-1`) — a gap means the indexer missed events, and building a path on an incomplete list would produce a root the contract never held.

The browser (`frontend/src/lib/merkleTree.ts::buildAuthPath`) rebuilds the tree from that list using the same Poseidon2 (exposed from the wasm as `poseidon_hash2_hex`), and `frontend/src/lib/poolClient.ts::prepareWithdraw` cross-checks that its reconstructed root matches the proof's root before ever letting the transaction be submitted.

### 5.7 The full flow, wired end to end

```
Sender (/create, "🔒 Seal the amount" toggle)
  → generateNote() — CSPRNG secret, reduced into the BLS12-381 scalar field
  → commitment = Poseidon2(secret, 0)             [computed in-browser, via wasm]
  → POST /api/pool/deposit/build-transaction        [backend builds + simulates]
  → sign with Freighter → POST /api/pool/submit
  → pool.deposit() locks 10 XLM, inserts commitment into the on-chain tree
  → sealed claim link: /claim/sealed#s=<secret>      (secret lives only in the URL fragment)

Indexer (backend, every 1 min + on every deposit)
  → GET deposit events from Soroban RPC → cache in MongoDB → GET /api/pool/leaves

Recipient (/claim/sealed#s=<secret>)
  → decode secret from the fragment (never sent to any server)
  → fetch /api/pool/leaves → rebuild Merkle path (browser wasm Poseidon2)
  → prove_withdraw_js(pk, secret, path, recipientSignal) — ~3s, in-browser
  → POST /api/pool/withdraw/build-transaction        [backend builds + simulates]
  → sign with Freighter → POST /api/pool/submit
  → pool.withdraw() verifies the proof cross-contract, burns the nullifier, pays the recipient
```

### 5.8 Live end-to-end proof (real testnet run)

This flow was driven fully on real testnet, with real XLM moving:

1. Pool initialized: XLM token, 10-XLM denomination, matching verifying key — tx `ba863cd3e863b4ad1c82135408df8389ae7b7074715a4886d74c4fcd580426ae`.
2. Deposit of a real note, 10 XLM locked — tx `5b0cba7877bd7ce84a8529db92211551d55c1c095e6a1ba3c027db8fd486d866`.
3. Backend indexer served the leaf immediately.
4. Browser wasm rebuilt the note's authentication path; the reconstructed root **matched the on-chain root exactly** (`0258d352d21bede9f471677ae192bc84393b49a7daf7cb164eff313b0d4be18d`).
5. Withdraw with that proof — tx `2d00058266a0c43583e7ce9cbaebf6184183bf9b70c68a0b643c8e723a832390` — paid the recipient exactly 10 XLM (balance **10000.0000000 → 10010.0000000**). The amount never appeared on-chain at any point in this flow.
6. Re-submitting the same (now-spent) nullifier was **rejected**.

Every component exercised was the real production code path (backend build endpoints, the browser wasm prover, the deployed contracts, the live indexer); only Freighter's human click-to-sign step was substituted with CLI signing for this run.

### 5.9 What's slice-grade — read before trusting this with real value

This is a working, measured, on-chain-verified system — and it is explicitly **not yet production-hardened**:

- **Poseidon2 round constants are a deterministic placeholder** (`ark[k] = k+1`), identical across the contract, the circuit gadget, and the native mirror — chosen to measure cost and prove correctness, not for security. Must be regenerated from a standard nothing-up-my-sleeve procedure before any real value flows through this.
- **Recipient binding is proven in the circuit but not re-derived on-chain** — the contract trusts the `recipient_signal` public input matches the `recipient` Address argument; production should re-derive that binding inside the contract.
- **Single-secret note scheme** — one `secret` derives both commitment and nullifier; production should split a spending key from a nullifier key and bind the asset/amount into the commitment.
- **Trusted setup used a test RNG**, not a real multi-party ceremony.
- **Contract errors are currently cosmetically mis-mapped** — pool errors surface through the `gift-escrow` error table (e.g. a spent-nullifier rejection currently reads as `NOT_RECEIVER`); the underlying rejection is correct, the message text isn't yet pool-specific.
- **Not audited.**

---

## 6. The Trustline Tradeoff

The single most consequential UX difference of a contract-only design. In classic Stellar, a `ChangeTrustOp` could be batched into the same multi-operation transaction as a claim. A Soroban transaction invokes exactly one contract function — there is no equivalent of "add another operation."

Concretely: the first time an account touches a non-native asset (anything but XLM) it needs **two separate signed transactions** — a `ChangeTrustOp` first, then the actual `create_gift`/`contribute`/`claim` invocation. Native XLM never requires this. `frontend/src/components/TrustlinePrompt.tsx` surfaces this as its own explicit step ("one more approval needed"), before the sign-and-send step, rather than letting the user hit an unexplained contract-call failure. This is a one-time cost per account per asset, accepted in exchange for not reintroducing the dual-mechanism complexity Section 2 avoids.

---

## 7. End-to-End User Flows

### 7.1 Sender Flow (ordinary gift)

Connect Freighter (`useFreighter`) → optional SEP-24 on-ramp (`OnrampModal`) → compose (asset, amount, message, theme, expiry, group-contribution toggle, condition type — all first-class fields, not "advanced mode") → trustline check if the asset is non-native → review (echoes everything that will be signed, never the trivia answer) → build (`POST /api/gifts`, `.../build-transaction`, simulated to resolve the nested-transfer auth tree) → sign with Freighter → `POST /api/gifts/:id/submit` → claim link + QR (`QrCodeCard`), plus a second contribution link if group gifting is on.

### 7.2 Sender Flow (sealed gift)

Same compose step, **"🔒 Seal the amount"** checked (disabled if group contributions are on — a sealed gift is a bearer note, not a multi-contributor pool) → review shows "Seal & send gift" instead of "Sign & send gift" → `useSealedDeposit`: mint note → `POST /api/pool/deposit/build-transaction` → sign → `POST /api/pool/submit` → **private claim link** (`/claim/sealed#s=<secret>`) shown with the same `QrCodeCard` used for ordinary gifts, plus an explicit warning that the secret lives only in the URL fragment and can't be recovered if lost.

### 7.3 Receiver Flow (ordinary gift)

`GET /claim/:token` → status branch (claimed/refunded/expired show terminal states) → condition check (`TriviaAnswerPrompt` fast pre-check, or `StepUnlockTracker` waiting view) → trustline check → build/sign/submit `claim` → success screen with the tx hash linked to stellar.expert.

### 7.4 Receiver Flow (sealed gift)

Open `/claim/sealed#s=<secret>` → connect Freighter → `useSealedClaim.claim()`: derive the recipient-binding field from the connected wallet (`recipientFieldFromPublicKey`) → `prepareWithdraw` (fetch indexed leaves → rebuild Merkle path → generate proof, ~3s, with a "Generating your private proof…" progress state) → `POST /api/pool/withdraw/build-transaction` → sign → `POST /api/pool/submit` → success screen, no amount ever shown or asked for.

---

## 8. Full System Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js 15)                         │
│  ┌────────┐ ┌──────────┐ ┌────────────────┐ ┌───────────────────┐    │
│  │ /create│ │/claim/[t]│ │  /claim/sealed  │ │ /dashboard, /gift │    │
│  └───┬────┘ └────┬─────┘ └────────┬────────┘ └─────────┬──────────┘  │
│      │           │                │                     │            │
│  ┌───▼───────────▼────────────────▼─────────────────────▼────────┐   │
│  │  Freighter (@stellar/freighter-api) · zk-prover-wasm (browser) │   │
│  └───────────────────────────────┬──────────────────────────────┘   │
└──────────────────────────────────┼───────────────────────────────────┘
                    REST (fetch)   │           signed XDR
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                       BACKEND (Express 5 + Mongoose)                  │
│  routes: gifts · claim · contribute · condition · onramp · pool       │
│  services: giftService · claimService · conditionService ·            │
│            reconciliationService · refundService · onrampService ·    │
│            poolService · poolIndexerService                           │
│  jobs (node-cron): refundCron · reconciliationCron · poolIndexerCron  │
│  MongoDB: Gift · ClaimEvent · Sep24Session · PoolLeaf · PoolSyncState │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │ @giffy/chain (build/simulate/submit)
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                 STELLAR TESTNET (Horizon + Soroban RPC)               │
│  ┌────────────────┐   ┌──────────────────┐   ┌─────────────────────┐ │
│  │  gift-escrow    │   │  shielded-pool    │──▶│  groth16-verifier  │ │
│  │  (open gifts)   │   │  (sealed gifts)   │   │  (cross-contract)  │ │
│  └────────┬────────┘   └────────┬──────────┘   └─────────────────────┘│
│           │                     │ token transfer (fixed denom)         │
│           ▼                     ▼                                     │
│  ┌─────────────┐        ┌──────────────┐                              │
│  │ XLM Native  │        │  Testnet     │                              │
│  │   (SAC)     │        │  USDC (SAC)  │                              │
│  └─────────────┘        └──────────────┘                              │
└───────────────────────────────────────────────────────────────────────┘

  testanchor.stellar.org  ◀── SEP-1 / SEP-10 / SEP-24 ──▶  onrampService.ts
  (classic-payment on-ramp into the sender's own account, unrelated to either contract)
```

### 8.1 Data flow — ordinary swap-free gift claim

```
Receiver opens /claim/:token
  → GET /api/claim/:token           (backend resolves token → contractGiftId, reads cached+reconciled state)
  → [condition] POST /api/claim/:token/verify-answer   (fast pre-check only, never authoritative)
  → POST /api/claim/:token/build-transaction  (backend re-validates server-side, simulates, returns signable XDR)
  → Freighter signs
  → POST /api/claim/:token/submit    (backend submits to Soroban RPC, polls to a terminal status,
                                       then calls gift-escrow.get_gift to reconcile the cache)
```

### 8.2 Data flow — sealed gift withdraw

See [§5.7](#57-the-full-flow-wired-end-to-end) for the full sealed-gift sequence diagram.

---

## 9. Repository Structure

```
giffy/
├── contracts/                     # Soroban smart contracts (Rust workspace)
│   ├── Cargo.toml
│   ├── gift-escrow/src/{lib,types,storage,errors,test}.rs
│   ├── groth16-verifier/src/{lib,test}.rs
│   └── shielded-pool/src/{lib,poseidon,test}.rs
│
├── zk-circuits/                   # native Rust: withdraw circuit (arkworks), no wasm
│   └── src/{lib,poseidon2}.rs
│
├── zk-prover-wasm/                # browser-wasm build of the withdraw prover
│   └── src/{lib,test}.rs
│
├── chain/                         # @giffy/chain — thin Stellar SDK wrapper, shared by backend + tests
│   └── src/
│       ├── giftEscrow.ts  shieldedPool.ts  sorobanClient.ts  horizonClient.ts
│       ├── sep1.ts  sep10.ts  sep24.ts  trustline.ts  assets.ts  accounts.ts
│       └── errors.ts  config.ts  types.ts  index.ts
│
├── backend/                       # @giffy/backend — Express REST API
│   └── src/
│       ├── routes/      gifts.ts  claim.ts  contribute.ts  condition.ts  onramp.ts  pool.ts
│       ├── services/    giftService.ts  claimService.ts  conditionService.ts
│       │                reconciliationService.ts  refundService.ts  onrampService.ts
│       │                poolService.ts  poolIndexerService.ts
│       ├── models/      Gift.ts  ClaimEvent.ts  Sep24Session.ts  PoolLeaf.ts  PoolSyncState.ts
│       ├── jobs/        refundCron.ts  reconciliationCron.ts  poolIndexerCron.ts
│       ├── validation/  giftSchemas.ts
│       ├── middleware/  validateRequest.ts  rateLimit.ts
│       └── config/      env.ts
│
├── frontend/                      # @giffy/frontend — Next.js 15 App Router
│   └── src/
│       ├── app/          page.tsx  create/page.tsx  dashboard/page.tsx
│       │                 claim/[token]/page.tsx  claim/sealed/page.tsx
│       │                 gift/[id]/contribute/page.tsx
│       ├── components/   Navbar  QrCodeCard  TriviaAnswerPrompt  StepUnlockTracker
│       │                 SealAmountToggle  TrustlinePrompt  OnrampModal  ui/{GlassCard,GlassButton,GlassInput}
│       ├── hooks/        useFreighter  useGift  useClaim  useContribute  useCondition  useOnramp
│       │                 useSealedDeposit  useSealedClaim
│       ├── lib/          apiClient.ts  assets.ts  formatters.ts  network.ts  stellarAddress.ts  trustline.ts
│       │                 zkProver.ts  shieldedNote.ts  merkleTree.ts  poolClient.ts
│       ├── wasm/zkprover/           # wasm-pack output (web target)
│       └── public/zk/               # served wasm + proving key + verifying key
│
├── docker-compose.yml              # local MongoDB (not used — backend points at Atlas by default)
└── LICENSE                         # MIT
```

---

## 10. Contract Layer

See [§4](#4-deep-dive-the-gift-escrow-contract) (`gift-escrow`) and [§5](#5-deep-dive-zero-knowledge-sealed-gifts) (`groth16-verifier` + `shielded-pool`) for full behavior. Build/deploy commands:

```bash
cd contracts

# Build all three contracts (wasm32v1-none target)
stellar contract build

# Or build one:
stellar contract build --package gift-escrow
stellar contract build --package groth16-verifier
stellar contract build --package shielded-pool

# Run all contract tests
cargo test --workspace

# Deploy (order matters for shielded-pool, which references the verifier at init time)
stellar contract deploy --wasm target/wasm32v1-none/release/gift_escrow.wasm --source deployer --network testnet
stellar contract deploy --wasm target/wasm32v1-none/release/groth16_verifier.wasm --source deployer --network testnet
stellar contract deploy --wasm target/wasm32v1-none/release/shielded_pool.wasm --source deployer --network testnet

# Initialize the pool once deployed
stellar contract invoke --id <POOL_ID> --source deployer --network testnet -- \
  initialize --config '{"token":"<XLM_SAC>","denom":"100000000","verifier":"<VERIFIER_ID>"}' \
  --vk '<verifying-key-json>'
```

---

## 11. Chain Layer (`/chain`)

`@giffy/chain` is the single place every Soroban/Horizon interaction goes through — the backend never talks to `stellar-sdk` directly.

| File | Responsibility |
|---|---|
| `sorobanClient.ts` | `buildAndSimulate` (build → simulate → return signable XDR, resolving the full auth tree), `submitSignedInvocation` (submit → poll to terminal status), `buildReadOnlyInvocation`. |
| `giftEscrow.ts` | Typed builders for every `gift-escrow` function. |
| `shieldedPool.ts` | `getPoolDepositEvents` (RPC event decoding, symbol-matched not topic-XDR-guessed), `getLatestLedger`, `buildPoolDepositTx`, `buildPoolWithdrawTx` (including the nested `Proof` ScVal construction). |
| `horizonClient.ts` / `trustline.ts` / `accounts.ts` | Classic-Horizon operations: trustline management, account existence/funding checks. |
| `sep1.ts` / `sep10.ts` / `sep24.ts` | Anchor `stellar.toml` resolution, SEP-10 challenge/sign/submit, SEP-24 interactive deposit + polling. |
| `assets.ts` | Known testnet asset issuers (SRT, USDC), amount validation. |
| `errors.ts` | `parseHorizonError` + `parseContractError` → one `ChainError` hierarchy the backend and frontend both consume. |
| `config.ts` | Zod-validated env (`SOROBAN_RPC_URL`, `GIFT_ESCROW_CONTRACT_ID`, `SHIELDED_POOL_CONTRACT_ID`, …), fails loudly at import time on misconfiguration. |

---

## 12. Backend (`/backend`)

Express 5 REST API, MongoDB via Mongoose, three background cron jobs.

### 12.1 Routes (`src/routes/`)

| Router | Mount | Purpose |
|---|---|---|
| `giftRoutes` | `/api/gifts` | Create/list gifts, build/submit the `create_gift` transaction. |
| `contributeRoutes` | `/api/gifts` | Build/submit `contribute`. |
| `conditionRoutes` | `/api/gifts` | Build/submit `unlock_step` (step-gate sender-side unlocking). |
| `claimRoutes` | `/api/claim` | Preview, verify-answer pre-check, build/submit `claim`. |
| `onrampRoutes` | `/api/onramp` | SEP-10 challenge, SEP-24 interactive deposit, status polling. |
| `poolRoutes` | `/api/pool` | `info`, `leaves`, `deposit/build-transaction`, `withdraw/build-transaction`, `submit`. |

### 12.2 Services (`src/services/`)

`giftService` (draft/build/submit), `claimService` (resolve token → build/submit claim, condition re-checks), `conditionService` (trivia hashing, step-unlock build/submit), `reconciliationService` (re-reads `get_gift` after every action, overwrites — never increments — the cache), `refundService` (the expiry sweep), `onrampService` (SEP flows), `poolService` (deposit/withdraw build + submit, kicks an indexer sync after a deposit), `poolIndexerService` (event sync + gap-checked leaf serving — full detail in [§5.6](#56-the-deposit-indexer) and `backend/src/services/POOL_INDEXER.md`).

### 12.3 Background jobs (`src/jobs/`, `node-cron`)

| Job | Schedule (default) | What it does |
|---|---|---|
| `refundCron` | `*/15 * * * *` | Sweeps `status=active, expiresAt < now` and triggers refunds. |
| `reconciliationCron` | `*/5 * * * *` | Re-reads every `active`/`refund_pending` gift from the contract, overwrites the cache. |
| `poolIndexerCron` | `*/1 * * * *` | Syncs new `deposit` events into `PoolLeaf`; only runs if `SHIELDED_POOL_CONTRACT_ID` is set. |

---

## 13. Frontend (`/frontend`)

Next.js 15 App Router, React 19, Tailwind — the "frosted-glass" design system (`GlassCard`/`GlassButton`/`GlassInput`: `bg-white/10 backdrop-blur-xl border-white/20`).

### 13.1 Pages

`/` (landing, with a dedicated callout for the sealed-gift feature) · `/create` (sender wizard) · `/claim/[token]` (ordinary claim) · `/claim/sealed` (sealed claim) · `/gift/[id]/contribute` (group contribution) · `/dashboard` (sender's gifts).

### 13.2 Sealed-gift specific modules (`src/lib/`)

| Module | Responsibility |
|---|---|
| `zkProver.ts` | Lazy-loads the wasm + proving key (normal gifts pay zero cost); exposes `noteCommitment()`, `proveWithdraw()`. |
| `shieldedNote.ts` | Note-secret generation (CSPRNG reduced into the BLS12-381 scalar field); claim-link encoding — the secret lives only in the URL **fragment**, never sent to any server. |
| `merkleTree.ts` | Rebuilds the pool's tree from indexed leaves; extracts one note's authentication path. |
| `poolClient.ts` | Ties it together: fetch leaves → build path → prove → cross-check root; `recipientFieldFromPublicKey` (SHA-256 of the wallet key mod the scalar field, the binding the proof commits to). |

---

## 14. Data Models (MongoDB)

| Collection | Model | Purpose |
|---|---|---|
| `gifts` | `Gift.ts` | Unified record for every gift — `status` (`draft/pending_chain/active/claimed/refund_pending/refunded`), `theme`, `condition` (`none/trivia/stepGate`), `contributions[]`, `claimTokenHash` (SHA-256; the raw token is never stored). |
| `claimevents` | `ClaimEvent.ts` | Audit trail: view / answer_attempted / claim_attempted. |
| `sep24sessions` | `Sep24Session.ts` | On-ramp session state for polling. |
| `poolleaves` | `PoolLeaf.ts` | Indexed sealed-pool deposit commitments, unique on `(poolId, leafIndex)`. |
| `poolsyncstates` | `PoolSyncState.ts` | The indexer's resume cursor (last-scanned ledger) per pool. |

---

## 15. API Reference

### Gifts
```
POST   /api/gifts                                  create draft
GET    /api/gifts                                   list sender's gifts
POST   /api/gifts/:id/build-transaction              build create_gift
POST   /api/gifts/:id/submit                         submit signed create_gift
POST   /api/gifts/:id/steps/unlock/build-transaction  build unlock_step
POST   /api/gifts/:id/steps/unlock/submit             submit unlock_step
```
### Contribute
```
GET    /api/gifts/:id/contribute                    contribution preview
POST   /api/gifts/:id/contribute/build-transaction   build contribute
POST   /api/gifts/:id/contribute/submit              submit contribute
```
### Claim
```
GET    /api/claim/:token                             preview
POST   /api/claim/:token/verify-answer                fast trivia pre-check
POST   /api/claim/:token/build-transaction             build claim
POST   /api/claim/:token/submit                        submit claim
```
### On-ramp
```
POST   /api/onramp/sep10-challenge
POST   /api/onramp/sep10-submit
POST   /api/onramp/deposit
GET    /api/onramp/deposit/:id/status
```
### Sealed pool
```
GET    /api/pool/info                                pool id + tree depth (404 if disabled)
GET    /api/pool/leaves                               ordered commitments (409 if indexer has a gap)
POST   /api/pool/deposit/build-transaction             build deposit(from, commitment)
POST   /api/pool/withdraw/build-transaction             build withdraw(root, nullifier, recipient, recipientSignal, proof)
POST   /api/pool/submit                                submit either (kind: 'deposit' | 'withdraw')
```
### Health
```
GET    /api/health                                    200 ok / 503 degraded (Mongo reachability)
```

---

## 16. State Machines

**Gift status:** `draft → pending_chain → active → {claimed | refund_pending → refunded}`

**Sealed note (implicit, off-chain-tracked by possession of the secret):** `deposited (indexed, unspent)` → `withdrawn (nullifier recorded on-chain)`. There is no `pending`/`refund_pending` equivalent — a sealed note has no expiry in this slice; it is spendable by whoever holds the secret for as long as it remains unspent.

---

## 17. Security Considerations

### 17.1 `gift-escrow`
- **Checks-effects-interactions** in `claim`/`refund`: status flips to `Claimed`/`Refunded` and is persisted *before* the external token transfer, so a reentrant call during that transfer can't observe a still-`Open` gift.
- **No on-chain gate on who may `contribute`** — any product-level restriction (e.g., "this gift doesn't accept group contributions") lives entirely in whether the backend ever exposes a contribution link for it. The contract will always accept a valid `contribute` for an `Open`, unexpired gift from anyone holding the `gift_id`.
- **Claim-token entropy, not obscurity** — 256-bit CSPRNG token, only its SHA-256 hash stored; every failure mode for an unknown/malformed/deleted-gift token collapses to the same generic not-found response so an enumerator can't distinguish "wrong guess" from "real gift, wrong reason."

### 17.2 Sealed pool
- **Nullifier double-spend prevention** enforced on-chain (`shielded-pool.withdraw` checks + persists the nullifier before payout) — verified live: a resubmitted, already-spent nullifier is rejected.
- **Front-running protection** — the proof commits to a `recipient_signal`; a proof cannot be re-pointed at a different payout address. Verified on-chain: a substituted-recipient proof returns `false` from the deployed verifier.
- **Everything in [§5.9](#59-whats-slice-grade--read-before-trusting-this-with-real-value)** — placeholder Poseidon2 constants, non-re-derived recipient binding, single-secret note scheme, test-RNG trusted setup, un-audited — is a real, open security gap, not a formality. Do not treat this pool as safe for value beyond testnet experimentation until those are closed.

### 17.3 General
- Rate limiting on claim-preview and gift routes (`express-rate-limit`); `helmet` + `cors` restricted to `CORS_ORIGIN`.
- All amounts held as decimal strings end-to-end, never parsed through `Number`, to avoid float precision loss before XDR-build time.
- Backend never stores plaintext trivia answers or note secrets — only their hashes (answers) or nothing at all (note secrets never reach the backend).

---

## 18. Wallet Integration (Freighter)

| File | Responsibility |
|---|---|
| `frontend/src/hooks/useFreighter.tsx` | Connect/disconnect, network detection + re-check on focus, `signXdr(xdr, networkPassphrase)` wrapping `@stellar/freighter-api`'s `signTransaction`. |
| `frontend/src/components/WalletConnectButton.tsx` | The connect/disconnect UI. |
| `frontend/src/components/NetworkGuard.tsx` | Blocks the claim/create flows if Freighter isn't on `TESTNET`. |

Every signed transaction in the app — `create_gift`, `contribute`, `unlock_step`, `claim`, `refund`, `deposit`, `withdraw` — goes through the same `signXdr` call; there is exactly one signing code path regardless of which contract or flow is involved.

---

## 19. XLM / USDC / Sealed-Pool Testnet Setup

| Asset | Type | Address |
|---|---|---|
| XLM | native (SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| USDC | testnet, via reference anchor | issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |

Fund a testnet account via [friendbot.stellar.org](https://friendbot.stellar.org). USDC/SRT are acquired through the in-app SEP-24 on-ramp modal against `testanchor.stellar.org` (note: the reference anchor currently anchors **SRT**, not USDC, by default — plan on-ramp copy accordingly).

**Sealed pool:** initialized for XLM at a fixed **10-XLM** denomination. Depositing any other amount will fail token-transfer validation inside `deposit`.

---

## 20. Testing — Run & Outputs

### Smart contracts (Rust / `soroban_sdk::testutils`)
```bash
cd contracts && cargo test --workspace
```
```
gift-escrow:        8 passed  (create+claim, trivia ✓/✗, step-gate, contribute totals, refund pro-rata, expiry)
groth16-verifier:    3 passed, 2 ignored  (valid proof verifies + budget report, tampered signal rejected, cost-vs-public-inputs)
shielded-pool:       2 passed  (on-chain Poseidon2 == circuit gadget; full deposit→withdraw→double-spend-rejected)
```

### ZK circuits (native)
```bash
cd zk-circuits && cargo test
```
```
running 2 tests
test gadget_matches_native_poseidon ... ok
test withdraw_proof_valid_and_fixture_emitted ... ok
```

### Browser prover cost (native measurement)
```bash
cd zk-prover-wasm && cargo test --release measure_pk_size_and_prove_time -- --nocapture
```
```
circuit constraints        : 2457
proving key (compressed)   : 770 KB
proof size (compressed)    : 192 bytes
NATIVE prove time (avg)    : ~88-228 ms   (browser wasm measured ~2.9s)
```

### Backend (Vitest)
```bash
cd backend && npm test
```
```
 Test Files  4 passed (4)
      Tests  75 passed (75)
```
Covers: error handler formatting, trivia-answer hashing (`answerHash.test.ts`), claim-token generation/validation, request validation schemas.

### Frontend
```bash
cd frontend && npm run typecheck   # tsc --noEmit — clean
cd frontend && npm run lint        # eslint (next lint)
```

---

## 21. CI/CD Pipeline

**Not yet configured** — there is no `.github/workflows/` directory in this repository, and the project is not currently under git version control. If/when CI is added, it should mirror what's already run manually and documented in [§20](#20-testing--run--outputs):

| Job | Steps |
|---|---|
| **contracts** | `cargo fmt --check` → `cargo test --workspace` → `stellar contract build` (all 3 packages) → upload wasm artifacts |
| **zk** | `cargo test` in `zk-circuits` and `zk-prover-wasm` (native measurement, not the full wasm-pack browser build, to keep CI fast) |
| **backend** | `npm ci` → `npm run typecheck` → `npm test` |
| **frontend** | `npm ci` → `npm run typecheck` → `npm run lint` → `npm run build` |

---

## 22. Deployment & Rollback

### Contracts (testnet)
Deploy in dependency order — `groth16-verifier` before `shielded-pool` (the pool's `initialize` takes the verifier's contract id):
```bash
cd contracts
stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/gift_escrow.wasm --source deployer --network testnet
stellar contract deploy --wasm target/wasm32v1-none/release/groth16_verifier.wasm --source deployer --network testnet
stellar contract deploy --wasm target/wasm32v1-none/release/shielded_pool.wasm --source deployer --network testnet
stellar contract invoke --id <POOL_ID> --source deployer --network testnet -- initialize --config '{...}' --vk '{...}'
```

### Backend + Frontend (local / self-hosted)
```bash
cd backend && npm install && npm run dev     # http://localhost:4000
cd frontend && npm install && npm run dev    # http://localhost:3000
```
Both read their contract ids from `.env` / `.env.local` (see [§23](#23-environment-variables)) — changing a deployed contract id means updating both files and restarting.

### Rollback
- **Contracts:** Soroban deploys are immutable per contract id. Roll back by re-pointing `GIFT_ESCROW_CONTRACT_ID` / `SHIELDED_POOL_CONTRACT_ID` at a previous known-good id and restarting the backend (and rebuilding the frontend for its `NEXT_PUBLIC_*` equivalents).
- **Backend/Frontend:** no hosted deployment target is configured yet; both currently run as local dev processes.

### Verification
After (re)starting: `GET /api/health` → `{"status":"ok","db":"connected"}`; `GET /api/pool/info` → 200 with the pool id if sealed gifts are enabled; open `/create`, compose a gift, and drive a claim through `/claim/[token]` (or `/claim/sealed` for a sealed gift) to confirm the full chain.

---

## 23. Environment Variables

### Backend (`backend/.env`)

| Variable | Example | Notes |
|---|---|---|
| `PORT` | `4000` | |
| `CORS_ORIGIN` | `http://localhost:3000` | |
| `MONGODB_URI` | `mongodb+srv://...` | Atlas by default; local `docker-compose.yml` Mongo is available but unused. |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | |
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | |
| `GIFT_ESCROW_CONTRACT_ID` | `CCABIQY...` | |
| `SHIELDED_POOL_CONTRACT_ID` | `CDDF4SNZ...` | Optional — sealed-gift routes/cron disabled entirely if unset. |
| `SHIELDED_POOL_START_LOOKBACK` | `100000` | Ledgers to scan on the indexer's first run. |
| `POOL_INDEXER_CRON_SCHEDULE` | `*/1 * * * *` | |
| `ANCHOR_HOME_DOMAIN` | `testanchor.stellar.org` | |
| `CLAIM_LINK_BASE_URL` / `CONTRIBUTE_LINK_BASE_URL` | `http://localhost:3000/claim` / `/gift` | |
| `CLAIM_TOKEN_BYTES` | `32` | |
| `REFUND_CRON_SCHEDULE` / `RECONCILIATION_CRON_SCHEDULE` | `*/15 * * * *` / `*/5 * * * *` | |
| `CLAIM_PREVIEW_RATE_LIMIT_*` / `GIFT_ROUTES_RATE_LIMIT_*` | | window/max pairs |

### Frontend (`frontend/.env.local`)

| Variable | Example |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000/api` |
| `NEXT_PUBLIC_HORIZON_URL` | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `TESTNET` |
| `NEXT_PUBLIC_GIFT_ESCROW_CONTRACT_ID` | `CCABIQY...` |
| `NEXT_PUBLIC_ANCHOR_HOME_DOMAIN` | `testanchor.stellar.org` |

---

## 24. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/api/pool/*` returns 404 `POOL_DISABLED` | `SHIELDED_POOL_CONTRACT_ID` unset | Set it in `backend/.env` and restart. |
| `/api/pool/leaves` returns 409 `INDEXER_BEHIND` | The indexer found a gap in leaf indices | Wait for the next cron sweep, or check RPC event retention — testnet RPC only retains events for a limited window; a very old, un-synced pool needs the indexer running continuously from near its deploy ledger. |
| "That answer isn't quite right" on a *correct* trivia answer | Answer normalization mismatch between the pre-check (normalized) and the on-chain hash check (must also be normalized before being sent to the contract) | Fixed in `claimService.ts` — the plaintext sent to `buildClaimTx` is normalized identically to how it was hashed at creation. |
| "Freighter not detected" | Extension missing/locked | Install from freighter.app; unlock; set network to Testnet. |
| Sealed claim stuck at "Generating your private proof…" | `/zk/pk.bin` or the wasm module failed to load | Check `public/zk/{pk.bin,zk_prover_wasm_bg.wasm}` are present and served (200). |
| Deposit/withdraw error message reads like a gift-escrow error (e.g. "Only the designated receiver…") | Known cosmetic issue — pool contract errors are currently parsed through the `gift-escrow` error table (§17.2) | The rejection itself is correct; only the displayed text is mismatched. Flagged for a pool-specific error table. |
| `cargo test` can't find `wasm32v1-none` target | Toolchain missing the target | `rustup target add wasm32v1-none` |
| Frontend shows unstyled/raw HTML | Stale `.next` cache on a long-running dev server | `rm -rf .next && npm run dev` |

---

## 25. Deployment Evidence

**Network:** Stellar Testnet · `Test SDF Network ; September 2015`

| Contract | Address (testnet) |
|---|---|
| gift-escrow | `CCABIQYBL53CPLZLXCDNG4TQ54RUCWHZJXFLCROETVU3LGGXQZXZUWT4` |
| groth16-verifier | `CBL4G6ER53DV5MJY72FAB2DJKBUSWSZEXGCA3ZGI4YTZHK2UH66LML43` |
| shielded-pool | `CDDF4SNZ6LRAZURFG37SAZQBDHD4S6DTOIQVAQZMLREIQNU2V77RXGS6` |
| XLM (SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

**Sealed-gift live run (real testnet transactions):**

| Step | Tx hash |
|---|---|
| Pool `initialize` | `ba863cd3e863b4ad1c82135408df8389ae7b7074715a4886d74c4fcd580426ae` |
| `deposit` (10 XLM locked) | `5b0cba7877bd7ce84a8529db92211551d55c1c095e6a1ba3c027db8fd486d866` |
| `withdraw` (10 XLM paid out, amount never on-chain) | `2d00058266a0c43583e7ce9cbaebf6184183bf9b70c68a0b643c8e723a832390` |

**Phase 0 spike (Groth16 feasibility on Soroban):** deployed verifier `CBL4G6ER...LML43`, verify tx `d8b3fa09c5305cd67e98e799af2bb330c5a1aa4c93b78f21775487fe1010f6e4` — 47,297,357 on-chain instructions, `true`.

**Phase 2 slice (real withdraw circuit, on-chain verify + soundness):** verify tx `0a160b318ac8fd26a16e8816dc0821e979e2a8d56b2fa05f7fe49ba7fe4aafb9` — 50,407,319 instructions, `true`; a substituted-recipient proof against the same verifier returned `false`.

**Test evidence:** 8 + 3 + 2 = 13 contract tests, 2 zk-circuits tests, 75 backend tests, all passing (§20). **Build evidence:** `stellar contract build` produces 3 wasms (8,766 / 2,915 / 12,188 bytes); `wasm-pack build --target web` produces the 468 KB browser prover.

---

## 26. Known Limitations & Roadmap

| Limitation | Impact | Roadmap |
|---|---|---|
| No CI/CD configured | Manual test/build verification only | Add the pipeline described in §21 once the repo is under git. |
| Sealed pool: single fixed denomination (10 XLM) | Can't seal arbitrary amounts | Proof-based deposit (§5.4) unlocks arbitrary tree depth; a join-split circuit would unlock arbitrary amounts. |
| Sealed pool: placeholder Poseidon2 constants, non-audited | Not safe for real value | See the full list in §5.9 / §17.2 — this is the single biggest pre-launch gate. |
| Pool contract error messages | Cosmetically wrong (mapped through gift-escrow's table) | Add a pool-specific `ChainErrorCode` set in `chain/src/errors.ts`. |
| No protocol/refund path for sealed notes | A sealed note has no expiry — lost secrets are unrecoverable by design | Consider an optional recovery/expiry mechanism if product needs it; tension with the bearer-note privacy model. |
| Indexer relies on RPC event retention | A long-idle deployment could miss deposit events if the indexer isn't run continuously | Document required uptime; consider an archival event source for production. |
| Single asset pair beyond XLM sealed pool (USDC not sealed) | USDC gifts can't currently be sealed | Deploy a second pool instance per asset/denomination. |

---

## License

MIT — see [LICENSE](LICENSE).
