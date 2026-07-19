import { Account, Address, SorobanDataBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChainError, GiftEscrowError, extractContractErrorCode, parseContractError } from '../src/errors.js';
import {
  buildClaimTx,
  buildCreateGiftTx,
  buildRefundTx,
  decodeCondition,
  encodeCondition,
  getGift,
} from '../src/giftEscrow.js';
import { sorobanServer } from '../src/sorobanClient.js';

const SOURCE = 'GDQK2MW24YTQO6QCP2JXWXLCDNLNQMDRZQHTAFNCAQ7JCZK64Q7MPEDU';
const RECEIVER = 'GDE7XGX224URB25XKXVHNCWFJBN2WBVMRKV5WGCQ7BUMTN5C6FXTDA35';
const TOKEN = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

/** A minimal, structurally valid successful-simulation response. */
function successfulSimulation(retval: xdr.ScVal): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '100',
    result: { auth: [], retval },
  };
}

/**
 * Builds a synthetic `xdr.DiagnosticEvent` carrying a contract error ScVal, the
 * same shape `soroban-rpc` returns inside a failed `getTransaction`'s
 * `diagnosticEventsXdr` (README §11.5) when the host's `panic_with_error!`
 * bubbles up as a `ScVal::Error(ScErrorType::Contract, code)`.
 */
function diagnosticEventWithContractError(code: number): xdr.DiagnosticEvent {
  const errorScVal = xdr.ScVal.scvError(xdr.ScError.sceContract(code));
  const eventV0 = new xdr.ContractEventV0({
    topics: [xdr.ScVal.scvSymbol('error')],
    data: errorScVal,
  });
  // `@stellar/stellar-sdk@13.3.0`'s shipped `.d.ts` for these two generated
  // union types declares numeric static factories (`ContractEventBody['0']`,
  // `ExtensionPoint['0']`) that don't actually exist on the runtime classes —
  // the real js-xdr `Union` constructor takes the switch value/name positionally
  // instead (verified directly against `node_modules/@stellar/js-xdr`).
  const ContractEventBodyCtor = xdr.ContractEventBody as unknown as new (
    armSwitch: number,
    value: xdr.ContractEventV0,
  ) => xdr.ContractEventBody;
  const ExtensionPointCtor = xdr.ExtensionPoint as unknown as new (
    armSwitch: number,
    value: undefined,
  ) => xdr.ExtensionPoint;

  const body = new ContractEventBodyCtor(0, eventV0);
  const event = new xdr.ContractEvent({
    ext: new ExtensionPointCtor(0, undefined),
    contractId: null,
    type: xdr.ContractEventType.diagnostic(),
    body,
  });
  return new xdr.DiagnosticEvent({ inSuccessfulContractCall: false, event });
}

describe('encodeCondition / decodeCondition', () => {
  it('round-trips the "none" condition', () => {
    const encoded = encodeCondition({ type: 'none' });
    expect(encoded.switch().name).toBe('scvVec');
    expect(encoded.vec()?.map((v) => v.sym().toString())).toEqual(['None']);

    const decoded = decodeCondition(['None']);
    expect(decoded).toEqual({ type: 'none' });
  });

  it('round-trips a trivia (AnswerHash) condition', () => {
    const answerHash = Buffer.from('a'.repeat(64), 'hex');
    const encoded = encodeCondition({ type: 'trivia', answerHash });

    const vec = encoded.vec();
    expect(vec).toHaveLength(2);
    expect(vec?.[0]?.sym().toString()).toBe('AnswerHash');
    expect(Buffer.from(vec?.[1]?.bytes() ?? [])).toEqual(answerHash);

    const decoded = decodeCondition(['AnswerHash', answerHash]);
    expect(decoded.type).toBe('trivia');
    expect(decoded.answerHash?.equals(answerHash)).toBe(true);
  });

  it('round-trips a stepGate condition', () => {
    const encoded = encodeCondition({ type: 'stepGate', totalSteps: 4 });

    const vec = encoded.vec();
    expect(vec?.[0]?.sym().toString()).toBe('StepGate');
    expect(vec?.[1]?.u32()).toBe(4);

    const decoded = decodeCondition(['StepGate', 4]);
    expect(decoded).toEqual({ type: 'stepGate', totalSteps: 4 });
  });

  it('throws building a trivia condition with no answerHash', () => {
    expect(() => encodeCondition({ type: 'trivia' })).toThrow(ChainError);
  });

  it('throws building a stepGate condition with no totalSteps', () => {
    expect(() => encodeCondition({ type: 'stepGate' })).toThrow(ChainError);
  });

  it('throws decoding an unrecognized variant', () => {
    expect(() => decodeCondition(['SomeFutureVariant'])).toThrow(ChainError);
  });

  it('throws decoding a malformed (non-array) value', () => {
    expect(() => decodeCondition({ tag: 'None' })).toThrow(ChainError);
    expect(() => decodeCondition(undefined)).toThrow(ChainError);
  });
});

describe('extractContractErrorCode', () => {
  it('returns null for null/undefined', () => {
    expect(extractContractErrorCode(null)).toBeNull();
    expect(extractContractErrorCode(undefined)).toBeNull();
  });

  it('extracts a code from a simulation error string', () => {
    const simulationError = {
      error:
        'HostError: Error(Contract, #6)\n\nEvent log (newest first):\n   0: [Diagnostic Event] contract call failed',
    };
    expect(extractContractErrorCode(simulationError)).toBe(6);
  });

  it('extracts a code from diagnosticEventsXdr (xdr.DiagnosticEvent objects)', () => {
    const failedGetTransaction = {
      status: 'FAILED',
      diagnosticEventsXdr: [diagnosticEventWithContractError(13)],
    };
    expect(extractContractErrorCode(failedGetTransaction)).toBe(13);
  });

  it('extracts a code from a diagnosticEvents field', () => {
    const sendTransactionError = {
      status: 'ERROR',
      diagnosticEvents: [diagnosticEventWithContractError(2)],
    };
    expect(extractContractErrorCode(sendTransactionError)).toBe(2);
  });

  it('extracts a code from a plain thrown Error message', () => {
    const err = new Error('simulation failed: Error(Contract, #10)');
    expect(extractContractErrorCode(err)).toBe(10);
  });

  it('returns null when nothing recognizable is present', () => {
    expect(extractContractErrorCode({ status: 'FAILED' })).toBeNull();
    expect(extractContractErrorCode(new Error('socket hang up'))).toBeNull();
  });
});

describe('parseContractError', () => {
  it('maps every documented GiftEscrowError code to its message (README §4.6 / §11.5)', () => {
    const cases: Array<[number, string]> = [
      [1, 'GIFT_NOT_FOUND'],
      [2, 'GIFT_NOT_OPEN'],
      [3, 'GIFT_EXPIRED'],
      [4, 'GIFT_NOT_YET_EXPIRED'],
      [5, 'NOT_RECEIVER'],
      [6, 'WRONG_ANSWER'],
      [7, 'STEPS_NOT_COMPLETE'],
      [8, 'NOT_AUTHORIZED_UNLOCKER'],
      [9, 'ALL_STEPS_ALREADY_COMPLETE'],
      [10, 'INVALID_CONTRIBUTION_AMOUNT'],
      [11, 'INVALID_EXPIRY'],
      [12, 'NOT_STEP_GATED'],
      [13, 'NOT_SENDER_OR_CONTRIBUTOR'],
    ];

    for (const [numericCode, expectedCode] of cases) {
      const err = parseContractError({ error: `HostError: Error(Contract, #${numericCode})` });
      expect(err).toBeInstanceOf(GiftEscrowError);
      expect(err.code).toBe(expectedCode);
      expect(err.contractErrorCode).toBe(numericCode);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it('falls back to UNKNOWN_CONTRACT_ERROR for an unrecognized numeric code', () => {
    const err = parseContractError({ error: 'HostError: Error(Contract, #999)' });
    expect(err.code).toBe('UNKNOWN_CONTRACT_ERROR');
    expect(err.contractErrorCode).toBe(999);
  });

  it('falls back to UNKNOWN_CONTRACT_ERROR when no code can be recovered at all', () => {
    const err = parseContractError(new Error('network timeout'));
    expect(err).toBeInstanceOf(GiftEscrowError);
    expect(err.code).toBe('UNKNOWN_CONTRACT_ERROR');
    expect(err.contractErrorCode).toBeNull();
  });

  it('keeps the raw payload on details for server-side logging only', () => {
    const raw = { error: 'HostError: Error(Contract, #5)' };
    const err = parseContractError(raw);
    expect(err.details).toBe(raw);
  });
});

/**
 * These mock `sorobanServer` (the shared Soroban RPC client — README §11.2)
 * directly, rather than hitting the network, so `buildCreateGiftTx` /
 * `buildClaimTx` / `buildRefundTx` / `getGift` are exercised through their real
 * simulate-then-assemble code path end to end.
 */
describe('gift-escrow transaction builders (mocked Soroban RPC)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buildCreateGiftTx simulates and returns a signable, single-operation XDR', async () => {
    vi.spyOn(sorobanServer, 'getAccount').mockResolvedValue(new Account(SOURCE, '100'));
    vi.spyOn(sorobanServer, 'simulateTransaction').mockResolvedValue(
      successfulSimulation(nativeToScVal(1n, { type: 'u64' })),
    );

    const xdrString = await buildCreateGiftTx({
      sourcePublicKey: SOURCE,
      receiverPublicKey: RECEIVER,
      tokenContractId: TOKEN,
      initialAmount: '1000000000',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      condition: { type: 'none' },
      stepUnlockerPublicKey: SOURCE,
      messageHash: Buffer.alloc(32, 1),
    });

    expect(typeof xdrString).toBe('string');
    expect(xdrString.length).toBeGreaterThan(0);
    expect(sorobanServer.getAccount).toHaveBeenCalledWith(SOURCE);
    expect(sorobanServer.simulateTransaction).toHaveBeenCalledOnce();
  });

  it('buildClaimTx propagates a parsed GiftEscrowError when simulation fails', async () => {
    vi.spyOn(sorobanServer, 'getAccount').mockResolvedValue(new Account(RECEIVER, '1'));
    vi.spyOn(sorobanServer, 'simulateTransaction').mockResolvedValue({
      id: '1',
      latestLedger: 100,
      events: [],
      _parsed: true,
      error: 'HostError: Error(Contract, #5)',
    } as rpc.Api.SimulateTransactionErrorResponse);

    await expect(
      buildClaimTx({ claimantPublicKey: RECEIVER, contractGiftId: 1n }),
    ).rejects.toMatchObject({ code: 'NOT_RECEIVER', contractErrorCode: 5 });
  });

  it('buildRefundTx surfaces GIFT_NOT_YET_EXPIRED from a failed simulation', async () => {
    vi.spyOn(sorobanServer, 'getAccount').mockResolvedValue(new Account(SOURCE, '1'));
    vi.spyOn(sorobanServer, 'simulateTransaction').mockResolvedValue({
      id: '1',
      latestLedger: 100,
      events: [],
      _parsed: true,
      error: 'HostError: Error(Contract, #4)',
    } as rpc.Api.SimulateTransactionErrorResponse);

    await expect(
      buildRefundTx({ callerPublicKey: SOURCE, contractGiftId: 7n }),
    ).rejects.toMatchObject({ code: 'GIFT_NOT_YET_EXPIRED', contractErrorCode: 4 });
  });

  it('getGift decodes a simulated get_gift result into a GiftRecord', async () => {
    // Built directly out of `xdr.ScVal` rather than via `nativeToScVal`'s
    // generic object/map inference (which has no notion of `soroban-sdk`'s
    // struct/enum wire conventions — see `encodeCondition`'s comment above) —
    // this is the actual shape a `#[contracttype] struct GiftRecord` decodes
    // to/from, verified against `scValToNative`'s real behavior.
    const mapEntry = (key: xdr.ScVal, val: xdr.ScVal) => new xdr.ScMapEntry({ key, val });
    const sym = (s: string) => xdr.ScVal.scvSymbol(s);

    const contributionsMap = xdr.ScVal.scvMap([
      mapEntry(new Address(SOURCE).toScVal(), nativeToScVal(1_000_000_000n, { type: 'i128' })),
    ]);

    const retval = xdr.ScVal.scvMap([
      mapEntry(sym('condition'), xdr.ScVal.scvVec([sym('None')])),
      mapEntry(sym('contributions'), contributionsMap),
      mapEntry(sym('expires_at'), nativeToScVal(4_000_000_000n, { type: 'u64' })),
      mapEntry(sym('receiver'), new Address(RECEIVER).toScVal()),
      mapEntry(sym('sender'), new Address(SOURCE).toScVal()),
      mapEntry(sym('status'), sym('Open')),
      mapEntry(sym('step_unlocker'), new Address(SOURCE).toScVal()),
      mapEntry(sym('steps_completed'), nativeToScVal(0, { type: 'u32' })),
      mapEntry(sym('token'), new Address(TOKEN).toScVal()),
      mapEntry(sym('total_amount'), nativeToScVal(1_000_000_000n, { type: 'i128' })),
    ]);

    vi.spyOn(sorobanServer, 'getAccount').mockResolvedValue(new Account(SOURCE, '1'));
    vi.spyOn(sorobanServer, 'simulateTransaction').mockResolvedValue(successfulSimulation(retval));

    const gift = await getGift(SOURCE, 42n);

    expect(gift.contractGiftId).toBe(42n);
    expect(gift.sender).toBe(SOURCE);
    expect(gift.receiver).toBe(RECEIVER);
    expect(gift.totalAmount).toBe('1000000000');
    expect(gift.status).toBe('Open');
    expect(gift.condition).toEqual({ type: 'none' });
    expect(gift.stepsCompleted).toBe(0);
    expect(gift.contributions).toEqual([{ address: SOURCE, amount: '1000000000' }]);
  });
});
