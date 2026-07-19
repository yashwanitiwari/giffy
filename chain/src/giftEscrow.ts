import { Address, nativeToScVal, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';

import { ChainError, parseContractError } from './errors.js';
import {
  buildAndSimulate,
  buildReadOnlyInvocation,
  giftEscrowContract,
  sorobanServer,
  submitSignedInvocation,
} from './sorobanClient.js';
import type { ClaimCondition, ClaimConditionType, GiftContribution, GiftRecord, GiftStatus } from './types.js';

/** The chain layer's input shape for a gift's claim condition (README §11.3). */
export interface ConditionInput {
  type: ClaimConditionType;
  /** Required, and only meaningful, when `type === 'trivia'`. */
  answerHash?: Buffer;
  /** Required, and only meaningful, when `type === 'stepGate'`. */
  totalSteps?: number;
}

/**
 * Encodes a `ConditionInput` into the `ClaimCondition` enum's ScVal
 * representation, matching the contract's `#[contracttype] enum ClaimCondition`
 * (README §4.1).
 *
 * Verified against the actual `@stellar/stellar-sdk@13.3.0` `nativeToScVal`
 * (`node_modules/@stellar/stellar-base/lib/scval.js`), which has no built-in
 * notion of a Rust-style tagged enum — a plain `{ tag, values }` object (as an
 * earlier sketch of this file assumed) would silently encode as an `ScMap`
 * instead, which the contract would reject. The wire format `soroban-sdk`'s
 * `#[contracttype]` derive macro actually uses for a data-carrying enum is a
 * `Vec` whose first element is a `Symbol` naming the variant, followed by the
 * variant's fields in declaration order — built here directly via `xdr.ScVal`
 * rather than relying on `nativeToScVal` to infer it.
 */
export function encodeCondition(condition: ConditionInput): xdr.ScVal {
  switch (condition.type) {
    case 'none':
      return xdr.ScVal.scvVec([nativeToScVal('None', { type: 'symbol' })]);
    case 'trivia':
      if (!condition.answerHash) {
        throw new ChainError('A trivia condition requires an answerHash.');
      }
      return xdr.ScVal.scvVec([
        nativeToScVal('AnswerHash', { type: 'symbol' }),
        nativeToScVal(condition.answerHash, { type: 'bytes' }),
      ]);
    case 'stepGate':
      if (condition.totalSteps === undefined) {
        throw new ChainError('A stepGate condition requires totalSteps.');
      }
      return xdr.ScVal.scvVec([
        nativeToScVal('StepGate', { type: 'symbol' }),
        nativeToScVal(condition.totalSteps, { type: 'u32' }),
      ]);
    default: {
      const exhaustive: never = condition.type;
      throw new ChainError(`Unknown claim condition type: ${String(exhaustive)}`);
    }
  }
}

/**
 * Decodes a `ClaimCondition` ScVal (as returned inside a `get_gift` result) back
 * into the chain layer's `ClaimCondition` shape. The inverse of
 * `encodeCondition` — a `scvVec` decodes via `scValToNative` to a plain JS
 * array, `[variantName, ...fields]`.
 */
export function decodeCondition(value: unknown): ClaimCondition {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ChainError('Malformed ClaimCondition value returned by the contract.');
  }

  const [tag, ...values] = value as [string, ...unknown[]];

  switch (tag) {
    case 'AnswerHash': {
      const raw = values[0];
      const answerHash = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBufferLike);
      return { type: 'trivia', answerHash };
    }
    case 'StepGate':
      return { type: 'stepGate', totalSteps: Number(values[0]) };
    case 'None':
      return { type: 'none' };
    default:
      throw new ChainError(`Unknown ClaimCondition variant returned by the contract: ${String(tag)}`);
  }
}

/**
 * `Map<Address, i128>` decodes via `scValToNative` to a plain JS object keyed
 * by the (already address-decoded) string keys, not a `Map` instance — see
 * `scValToNative`'s `scvMap` case, which builds its result with
 * `Object.fromEntries`.
 */
function decodeContributions(value: unknown): GiftContribution[] {
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.map(([address, amount]) => ({
    address,
    amount: String(amount),
  }));
}

function decodeGiftRecord(contractGiftId: bigint, native: Record<string, unknown>): GiftRecord {
  return {
    contractGiftId,
    sender: String(native.sender),
    receiver: String(native.receiver),
    token: String(native.token),
    totalAmount: String(native.total_amount),
    contributions: decodeContributions(native.contributions),
    expiresAt: new Date(Number(native.expires_at) * 1000),
    // `GiftStatus` is a fieldless enum, so soroban-sdk encodes/decodes it as a
    // plain `Symbol` rather than the `Vec` form used for `ClaimCondition` —
    // `scValToNative` already turns that into a plain string.
    status: String(native.status) as GiftStatus,
    condition: decodeCondition(native.condition),
    stepsCompleted: Number(native.steps_completed),
    stepUnlocker: String(native.step_unlocker),
  };
}

export interface BuildCreateGiftTxParams {
  sourcePublicKey: string;
  receiverPublicKey: string;
  tokenContractId: string;
  /** i128 stroop amount, as a decimal string — never a `number` (precision). */
  initialAmount: string;
  expiresAt: Date;
  condition: ConditionInput;
  stepUnlockerPublicKey: string;
  messageHash: Buffer;
}

export async function buildCreateGiftTx(params: BuildCreateGiftTxParams): Promise<string> {
  return buildAndSimulate({
    sourcePublicKey: params.sourcePublicKey,
    method: 'create_gift',
    args: [
      new Address(params.sourcePublicKey).toScVal(),
      new Address(params.receiverPublicKey).toScVal(),
      new Address(params.tokenContractId).toScVal(),
      nativeToScVal(params.initialAmount, { type: 'i128' }),
      nativeToScVal(Math.floor(params.expiresAt.getTime() / 1000), { type: 'u64' }),
      encodeCondition(params.condition),
      new Address(params.stepUnlockerPublicKey).toScVal(),
      nativeToScVal(params.messageHash, { type: 'bytes' }),
    ],
  });
}

export interface BuildContributeTxParams {
  contributorPublicKey: string;
  contractGiftId: bigint;
  /** i128 stroop amount, as a decimal string. */
  amount: string;
}

export async function buildContributeTx(params: BuildContributeTxParams): Promise<string> {
  return buildAndSimulate({
    sourcePublicKey: params.contributorPublicKey,
    method: 'contribute',
    args: [
      new Address(params.contributorPublicKey).toScVal(),
      nativeToScVal(params.contractGiftId, { type: 'u64' }),
      nativeToScVal(params.amount, { type: 'i128' }),
    ],
  });
}

export interface BuildUnlockStepTxParams {
  unlockerPublicKey: string;
  contractGiftId: bigint;
}

export async function buildUnlockStepTx(params: BuildUnlockStepTxParams): Promise<string> {
  return buildAndSimulate({
    sourcePublicKey: params.unlockerPublicKey,
    method: 'unlock_step',
    args: [
      new Address(params.unlockerPublicKey).toScVal(),
      nativeToScVal(params.contractGiftId, { type: 'u64' }),
    ],
  });
}

export interface BuildClaimTxParams {
  claimantPublicKey: string;
  contractGiftId: bigint;
  /** Plaintext trivia answer. Omitted entirely for `none`/`stepGate` conditions. */
  answerPlaintext?: string;
}

export async function buildClaimTx(params: BuildClaimTxParams): Promise<string> {
  return buildAndSimulate({
    sourcePublicKey: params.claimantPublicKey,
    method: 'claim',
    args: [
      nativeToScVal(params.contractGiftId, { type: 'u64' }),
      new Address(params.claimantPublicKey).toScVal(),
      params.answerPlaintext !== undefined
        ? nativeToScVal(Buffer.from(params.answerPlaintext, 'utf-8'), { type: 'bytes' })
        : nativeToScVal(null),
    ],
  });
}

export interface BuildRefundTxParams {
  callerPublicKey: string;
  contractGiftId: bigint;
}

export async function buildRefundTx(params: BuildRefundTxParams): Promise<string> {
  return buildAndSimulate({
    sourcePublicKey: params.callerPublicKey,
    method: 'refund',
    args: [
      nativeToScVal(params.contractGiftId, { type: 'u64' }),
      new Address(params.callerPublicKey).toScVal(),
    ],
  });
}

/**
 * Reads a gift's current on-chain state directly from the contract (README
 * §4.3's `get_gift`). No auth is required — this is a plain simulated read,
 * never submitted — which is what `reconciliationService` (README §12.6) calls
 * after every state-changing action to overwrite, never increment, its cache.
 *
 * `readerPublicKey` only needs to be a syntactically valid, funded account to
 * serve as the simulation's source account; it is never charged and never
 * signs anything.
 */
export async function getGift(readerPublicKey: string, contractGiftId: bigint): Promise<GiftRecord> {
  const tx = await buildReadOnlyInvocation(readerPublicKey, 'get_gift', [
    nativeToScVal(contractGiftId, { type: 'u64' }),
  ]);

  const simulated = await sorobanServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) {
    throw parseContractError(simulated);
  }

  const retval = simulated.result?.retval;
  if (!retval) {
    throw new ChainError(`get_gift(${contractGiftId}) returned no value.`);
  }

  const native = scValToNative(retval) as Record<string, unknown>;
  return decodeGiftRecord(contractGiftId, native);
}

export { giftEscrowContract, submitSignedInvocation };
