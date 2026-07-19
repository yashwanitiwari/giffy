# groth16-verifier — Phase 0 spike (ZK-sealed gift amounts)

This crate exists to answer **one make-or-break question** before we invest in
confidential gift amounts:

> Can a Soroban contract verify a Groth16 zk-SNARK proof (BLS12-381) within the
> network's per-transaction instruction budget — and how much of that budget
> does it eat?

If proof verification doesn't fit on-chain, the whole shielded-pool design
(Phase 1+) is dead on arrival. It does fit, with room to spare.

## What this is

A generic, on-chain Groth16 verifier built entirely on the BLS12-381 host
functions added in Protocol 22 (`g1_msm`, `g1_mul`, `g1_add`, `pairing_check`,
`fr_sub`). It checks the standard equation

```
e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
   where vk_x = IC[0] + Σ signalsᵢ · IC[i+1]
```

as a single `pairing_check` over 4 pairs. See `src/lib.rs`.

It is **not** yet wired to a shielded pool — no Merkle tree, no nullifiers, no
token custody. That is Phase 1. This is purely the cost/feasibility probe plus a
reusable verifier core.

## Result

| Metric | Value | Notes |
|---|---|---|
| **On-chain CPU instructions** | **47,297,357** | real testnet invocation, authoritative |
| Native test estimate | 44,902,198 | SDK lower bound; within ~5% of on-chain |
| Soroban tx instruction limit | 100,000,000 | hard per-transaction ceiling |
| **Headroom left** | **~52.7M (~53%)** | budget available for pool logic in Phase 1 |
| Contract wasm size | 2,915 bytes | arkworks stays in tests, never in the wasm |
| Memory | ~415 KB | well under limits |

**Verdict: feasible.** One Groth16 verify uses ~47% of a transaction's compute.
The remaining ~53% is enough for the surrounding shielded-pool work (Merkle path
update, nullifier read/write, SAC token transfer), though it is not unlimited —
Phase 1 must budget deliberately and keep the circuit's public-input count small.

### Where the cost goes (host cost model)

| Operation | CPU insns | Share |
|---|---|---|
| `pairing_check` (4 pairs) | 30,335,852 | ~64% |
| G2 subgroup checks | 4,231,288 | ~9% |
| `g1_msm` (public inputs) | 3,083,017 | ~7% |
| `g1_mul` (the `-A` negation) | 2,458,985 | ~5% |
| everything else (glue, VM) | ~7.1M | ~15% |

Because the pairing dominates and is a *host* function, the number is stable and
largely independent of the surrounding Rust — which is why the native estimate
tracked the on-chain figure so closely.

### Phase 1 optimization notes

- The 2.46M spent negating `A` via `g1_mul(A, r-1)` can be removed by baking a
  pre-negated term into the (trusted, fixed) verifying key off-chain, saving ~5%.
- `g1_msm` cost scales with the number of public inputs. Keep the circuit's
  public signals minimal (e.g. Merkle root, nullifier, output commitment) —
  every extra public input adds an msm term.
- 4-pair `pairing_check` is fixed regardless of circuit size, so a bigger circuit
  does **not** cost more to verify. Good news for a real shielded-pool circuit.

## Reproduce

```bash
# 1. Unit tests: generates a real proof, verifies on-chain (SDK env), prints budget
cargo test -p groth16-verifier -- --nocapture

# 2. Build the wasm
stellar contract build --package groth16-verifier

# 3. Emit the fixture as CLI-ready JSON
cargo test -p groth16-verifier emit_fixture -- --ignored
#   -> groth16-verifier/target/phase0-fixture/{vk,proof,signals}.json

# 4. Deploy + invoke on testnet (authoritative metering)
stellar contract deploy --wasm target/wasm32v1-none/release/groth16_verifier.wasm \
  --source deployer --network testnet
cd groth16-verifier/target/phase0-fixture
stellar contract invoke --id <DEPLOYED_ID> --source deployer --network testnet \
  --send=yes -- verify --vk "$(cat vk.json)" --proof "$(cat proof.json)" \
  --signals "$(cat signals.json)"   # => true
```

## Testnet artifacts (this spike)

- Contract: `CBL4G6ER53DV5MJY72FAB2DJKBUSWSZEXGCA3ZGI4YTZHK2UH66LML43`
- Verify tx: `d8b3fa09c5305cd67e98e799af2bb330c5a1aa4c93b78f21775487fe1010f6e4`
  (status SUCCESS, return `true`, 47,297,357 instructions)

## Serialization gotcha (for Phase 1)

Soroban wants uncompressed **big-endian** coordinates, and G2 is ordered
`c1` before `c0`:

- G1 (96B): `be(X) || be(Y)`
- G2 (192B): `be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0)`
- Fr (32B): `be(scalar)`

`src/test.rs` pulls the integer out of each arkworks field element and lays it
out by hand rather than trusting ark-serialize's flag/endianness conventions —
reuse that adapter in Phase 1.
