import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

import { config, TRANSACTION_TIMEOUT_SECONDS } from './config.js';
import { parseContractError } from './errors.js';
import { sorobanServer } from './sorobanClient.js';

/**
 * Read side of the confidential gift pool (`contracts/shielded-pool`).
 *
 * The pool emits a `deposit` event per note — topic `("deposit", leafIndex)` with
 * the 32-byte commitment as the value. The backend indexer replays these to build
 * the ordered commitment list a recipient needs to reconstruct their Merkle path
 * (README: sealed-gift flow). This module owns the RPC event decoding; storage and
 * scheduling live in the backend.
 */

export interface DepositEvent {
  leafIndex: number;
  /** 32-byte note commitment, lowercase hex. */
  commitment: string;
  ledger: number;
  txHash: string;
}

export interface DepositEventPage {
  events: DepositEvent[];
  /** Ledger to resume from on the next poll (exclusive of what's returned). */
  latestLedger: number;
}

function requirePoolId(): string {
  if (!config.SHIELDED_POOL_CONTRACT_ID) {
    throw new Error('SHIELDED_POOL_CONTRACT_ID is not configured.');
  }
  return config.SHIELDED_POOL_CONTRACT_ID;
}

function toHex(value: unknown): string {
  // scValToNative decodes BytesN<32> to a Node Buffer / Uint8Array.
  const bytes = value as Uint8Array;
  return Buffer.from(bytes).toString('hex').padStart(64, '0');
}

/**
 * Fetch `deposit` events from `startLedger` onward. Pages through the RPC's
 * cursor until exhausted, returning them in ledger order plus the latest ledger
 * seen (the resume point for the next sync).
 */
export async function getPoolDepositEvents(startLedger: number): Promise<DepositEventPage> {
  const poolId = requirePoolId();
  const collected: DepositEvent[] = [];

  let cursor: string | undefined;
  let latestLedger = startLedger;

  // Filter by contract only; the event symbol is matched in code below so we
  // never depend on a hand-encoded topic XDR.
  const filters = [{ type: 'contract' as const, contractIds: [poolId] }];

  // The RPC caps events per call; loop on the returned cursor until drained.
  for (;;) {
    // The request is a union: page 1 is keyed by startLedger, subsequent pages by
    // cursor — never both.
    const page = await sorobanServer.getEvents(
      cursor ? { cursor, filters, limit: 200 } : { startLedger, filters, limit: 200 },
    );

    latestLedger = page.latestLedger;

    for (const ev of page.events) {
      // topic = [ symbol "deposit", u32 leafIndex ]; value = BytesN<32> commitment.
      const [topic0, topic1] = ev.topic;
      if (!topic0 || !topic1 || scValToNative(topic0) !== 'deposit') continue;
      collected.push({
        leafIndex: Number(scValToNative(topic1)),
        commitment: toHex(scValToNative(ev.value)),
        ledger: ev.ledger,
        txHash: ev.txHash,
      });
    }

    if (page.events.length < 200 || !page.cursor) break;
    cursor = page.cursor;
  }

  collected.sort((a, b) => a.leafIndex - b.leafIndex);
  return { events: collected, latestLedger };
}

/** Current ledger sequence — used to bound the initial event-scan window. */
export async function getLatestLedger(): Promise<number> {
  const { sequence } = await sorobanServer.getLatestLedger();
  return sequence;
}

// ---- write side: deposit / withdraw transaction builders --------------------

const hexToBuf = (hex: string): Buffer => Buffer.from(hex.replace(/^0x/, ''), 'hex');
const scBytes = (hex: string): xdr.ScVal => xdr.ScVal.scvBytes(hexToBuf(hex));

/** Build + simulate a pool invocation, returning the signable (assembled) XDR. */
async function buildPoolInvocation(
  sourcePublicKey: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const pool = new Contract(requirePoolId());
  const account = await sorobanServer.getAccount(sourcePublicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(pool.call(method, ...args))
    .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
    .build();

  const simulated = await sorobanServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) {
    throw parseContractError(simulated);
  }
  return rpc.assembleTransaction(tx, simulated).build().toXDR();
}

export interface BuildDepositParams {
  fromPublicKey: string;
  /** 32-byte note commitment (hex) — `Poseidon2(secret, 0)`. */
  commitmentHex: string;
}

/** `deposit(from, commitment)` — the sender locks the denomination + inserts a note. */
export async function buildPoolDepositTx(params: BuildDepositParams): Promise<string> {
  return buildPoolInvocation(params.fromPublicKey, 'deposit', [
    new Address(params.fromPublicKey).toScVal(),
    scBytes(params.commitmentHex),
  ]);
}

export interface WithdrawProofInput {
  a: string;
  b: string;
  c: string;
}

export interface BuildWithdrawParams {
  /** Source account that pays the fee and submits (may be a relayer). */
  sourcePublicKey: string;
  rootHex: string;
  nullifierHex: string;
  recipientPublicKey: string;
  recipientSignalHex: string;
  proof: WithdrawProofInput;
}

/**
 * `withdraw(root, nullifier, recipient, recipient_signal, proof)`. The `proof` is
 * the contract's `Proof` struct — an ScMap with fields `a`/`b`/`c`, which
 * `nativeToScVal` builds from a plain object with `bytes`-typed values.
 */
export async function buildPoolWithdrawTx(params: BuildWithdrawParams): Promise<string> {
  const proofScVal = nativeToScVal(
    {
      a: hexToBuf(params.proof.a),
      b: hexToBuf(params.proof.b),
      c: hexToBuf(params.proof.c),
    },
    { type: { a: ['symbol', 'bytes'], b: ['symbol', 'bytes'], c: ['symbol', 'bytes'] } },
  );

  return buildPoolInvocation(params.sourcePublicKey, 'withdraw', [
    scBytes(params.rootHex),
    scBytes(params.nullifierHex),
    new Address(params.recipientPublicKey).toScVal(),
    scBytes(params.recipientSignalHex),
    proofScVal,
  ]);
}

export function isShieldedPoolConfigured(): boolean {
  return Boolean(config.SHIELDED_POOL_CONTRACT_ID);
}

export function shieldedPoolContractId(): string {
  return requirePoolId();
}
