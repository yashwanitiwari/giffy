import { xdr as xdrNs, scValToNative } from '@stellar/stellar-sdk';

/**
 * Typed chain errors.
 *
 * Two independent things get parsed into this one hierarchy:
 *  - `parseHorizonError` maps classic Horizon's `extras.result_codes` shape,
 *    which is still relevant because trustline management (README §6 / §11.4)
 *    is the one deliberate exception that still talks to classic Horizon.
 *  - `parseContractError` maps a Soroban simulation/transaction failure onto
 *    the `gift-escrow` contract's own error codes (README §4.6 / §11.5).
 *
 * Both funnel into the same `ChainError` base so the backend and frontend only
 * ever need to handle one error shape, regardless of which half of the chain
 * layer produced it — the same "fail loud, fail specific" principle carried
 * through the whole system (README §8.3).
 */
export type ChainErrorCode =
  // Classic Horizon / trustline errors.
  | 'INSUFFICIENT_BALANCE'
  | 'CLAIM_NOT_YET_AVAILABLE'
  | 'CLAIM_EXPIRED'
  | 'TRUSTLINE_MISSING'
  | 'BAD_SEQUENCE'
  | 'ACCOUNT_NOT_FOUND'
  | 'BALANCE_NOT_FOUND'
  | 'ANCHOR_ERROR'
  // gift-escrow contract errors (README §4.6).
  | 'GIFT_NOT_FOUND'
  | 'GIFT_NOT_OPEN'
  | 'GIFT_EXPIRED'
  | 'GIFT_NOT_YET_EXPIRED'
  | 'NOT_RECEIVER'
  | 'WRONG_ANSWER'
  | 'STEPS_NOT_COMPLETE'
  | 'NOT_AUTHORIZED_UNLOCKER'
  | 'ALL_STEPS_ALREADY_COMPLETE'
  | 'INVALID_CONTRIBUTION_AMOUNT'
  | 'INVALID_EXPIRY'
  | 'NOT_STEP_GATED'
  | 'NOT_SENDER_OR_CONTRIBUTOR'
  | 'UNKNOWN_CONTRACT_ERROR'
  | 'CHAIN_ERROR';

export class ChainError extends Error {
  readonly code: ChainErrorCode = 'CHAIN_ERROR';

  /** Raw Horizon/Soroban/anchor payload. Log it server-side; never return it to a client. */
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class InsufficientBalanceError extends ChainError {
  override readonly code = 'INSUFFICIENT_BALANCE' as const;
}

/** Predicate not yet satisfied — e.g. a sender attempting reclaim before expiry. */
export class ClaimNotYetAvailableError extends ChainError {
  override readonly code = 'CLAIM_NOT_YET_AVAILABLE' as const;
}

/** Predicate no longer satisfied — e.g. a receiver claiming after expiry. */
export class ClaimExpiredError extends ChainError {
  override readonly code = 'CLAIM_EXPIRED' as const;
}

export class TrustlineMissingError extends ChainError {
  override readonly code = 'TRUSTLINE_MISSING' as const;
}

export class BadSequenceError extends ChainError {
  override readonly code = 'BAD_SEQUENCE' as const;
}

export class AccountNotFoundError extends ChainError {
  override readonly code = 'ACCOUNT_NOT_FOUND' as const;
}

export class BalanceNotFoundError extends ChainError {
  override readonly code = 'BALANCE_NOT_FOUND' as const;
}

/** A SEP-1/10/24 exchange with the anchor failed. */
export class AnchorError extends ChainError {
  override readonly code = 'ANCHOR_ERROR' as const;
}

/**
 * Thrown for every `gift-escrow` contract failure. `contractErrorCode` carries the
 * raw numeric `GiftEscrowError` value (README §4.6) when it could be recovered,
 * and is `null` when the failure couldn't be attributed to a specific contract
 * error (a network error, a trapped-without-diagnostics failure, etc).
 */
export class GiftEscrowError extends ChainError {
  constructor(
    override readonly code: ChainErrorCode,
    message: string,
    readonly contractErrorCode: number | null,
    details?: unknown,
  ) {
    super(message, details);
  }
}

interface HorizonErrorShape {
  response?: {
    status?: number;
    data?: {
      status?: number;
      title?: string;
      detail?: string;
      extras?: {
        result_codes?: {
          transaction?: string;
          operations?: string[];
        };
      };
    };
  };
}

function asHorizonError(err: unknown): HorizonErrorShape['response'] | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const response = (err as HorizonErrorShape).response;
  if (typeof response !== 'object' || response === null) return undefined;
  return response;
}

/**
 * Horizon returns `op_cannot_claim` whenever a claim cannot proceed, without saying
 * why: the same code covers a receiver claiming too late, a sender reclaiming too
 * early, and an account that is not a claimant at all. The caller supplies the
 * intent to disambiguate the first two, which are the cases Giffy actually
 * produces — the backend rejects a non-claimant before building anything, by
 * checking the requester against the gift's stored receiver.
 */
export type ClaimIntent = 'receive' | 'refund';

function mapOperationCode(code: string, intent: ClaimIntent, details: unknown): ChainError | null {
  switch (code) {
    case 'op_underfunded':
      return new InsufficientBalanceError(
        'The source account does not hold enough of this asset to cover the amount plus fees.',
        details,
      );

    case 'op_low_reserve':
      return new InsufficientBalanceError(
        'The source account does not hold enough XLM to meet the minimum reserve this operation requires.',
        details,
      );

    case 'op_no_trust':
    case 'op_no_issuer':
    case 'op_not_authorized':
      return new TrustlineMissingError(
        'The account needs a trustline to this asset before it can hold it.',
        details,
      );

    case 'op_cannot_claim':
      return intent === 'refund'
        ? new ClaimNotYetAvailableError(
            'This gift has not expired yet, so it cannot be reclaimed.',
            details,
          )
        : new ClaimExpiredError("This gift's claim window has passed.", details);

    case 'op_does_not_exist':
      return new BalanceNotFoundError(
        'This claimable balance no longer exists on the ledger — it may have already been claimed.',
        details,
      );

    case 'op_no_destination':
      return new AccountNotFoundError(
        'The destination account does not exist on this network.',
        details,
      );

    case 'op_success':
      return null;

    default:
      return null;
  }
}

function mapTransactionCode(code: string, details: unknown): ChainError | null {
  switch (code) {
    case 'tx_bad_seq':
      return new BadSequenceError(
        'This transaction was built against a stale sequence number. Rebuild and sign it again.',
        details,
      );

    case 'tx_insufficient_balance':
      return new InsufficientBalanceError(
        'The source account does not hold enough XLM to cover the transaction fee.',
        details,
      );

    case 'tx_no_source_account':
      return new AccountNotFoundError(
        'The source account does not exist on this network. It must be funded before it can transact.',
        details,
      );

    case 'tx_too_late':
      return new ChainError(
        'This transaction expired before it was submitted. Rebuild and sign it again.',
        details,
      );

    case 'tx_failed':
      // The real cause is in result_codes.operations, handled by the caller first.
      return null;

    case 'tx_success':
      return null;

    default:
      return null;
  }
}

/**
 * Maps an unknown thrown value onto a typed `ChainError`.
 *
 * Operation codes are checked before the transaction code, because `tx_failed` is
 * only ever a wrapper announcing that some operation inside the transaction failed
 * — the actionable detail is always in the operations array.
 *
 * This is the classic-Horizon path, used only by `trustline.ts` and `accounts.ts`
 * (README §11.4) — every other action in this module goes through the contract and
 * is parsed by `parseContractError` instead.
 */
export function parseHorizonError(err: unknown, intent: ClaimIntent = 'receive'): ChainError {
  if (err instanceof ChainError) return err;

  const response = asHorizonError(err);
  const data = response?.data;
  const resultCodes = data?.extras?.result_codes;

  if (resultCodes) {
    for (const opCode of resultCodes.operations ?? []) {
      const mapped = mapOperationCode(opCode, intent, data);
      if (mapped) return mapped;
    }

    if (resultCodes.transaction) {
      const mapped = mapTransactionCode(resultCodes.transaction, data);
      if (mapped) return mapped;
    }

    const summary =
      resultCodes.operations?.filter((c) => c !== 'op_success').join(', ') ??
      resultCodes.transaction ??
      'unknown';
    return new ChainError(`Horizon rejected this transaction (${summary}).`, data);
  }

  const status = response?.status ?? data?.status;
  if (status === 404) {
    return new AccountNotFoundError('This resource does not exist on the network.', data);
  }

  if (err instanceof Error) {
    return new ChainError(err.message, err);
  }

  return new ChainError('An unexpected error occurred while talking to the Stellar network.', err);
}

/**
 * `gift-escrow`'s `GiftEscrowError` enum (README §4.6), mirrored here so every
 * contract panic maps to a distinct, human-readable message end to end.
 */
const CONTRACT_ERROR_MESSAGES: Record<number, { code: ChainErrorCode; message: string }> = {
  1: { code: 'GIFT_NOT_FOUND', message: 'This gift does not exist on-chain.' },
  2: { code: 'GIFT_NOT_OPEN', message: 'This gift is no longer open.' },
  3: { code: 'GIFT_EXPIRED', message: "This gift's claim window has passed." },
  4: { code: 'GIFT_NOT_YET_EXPIRED', message: 'This gift has not expired yet.' },
  5: { code: 'NOT_RECEIVER', message: 'Only the designated receiver can claim this gift.' },
  6: { code: 'WRONG_ANSWER', message: "That answer isn't quite right — try again." },
  7: { code: 'STEPS_NOT_COMPLETE', message: 'Not all unlock steps have been completed yet.' },
  8: {
    code: 'NOT_AUTHORIZED_UNLOCKER',
    message: 'This account is not authorized to unlock steps for this gift.',
  },
  9: { code: 'ALL_STEPS_ALREADY_COMPLETE', message: 'All steps are already unlocked.' },
  10: { code: 'INVALID_CONTRIBUTION_AMOUNT', message: 'Amount must be greater than zero.' },
  11: { code: 'INVALID_EXPIRY', message: 'Expiry must be in the future.' },
  12: { code: 'NOT_STEP_GATED', message: 'This gift has no step-based condition.' },
  13: {
    code: 'NOT_SENDER_OR_CONTRIBUTOR',
    message: 'Only the sender or a contributor can trigger a refund.',
  },
};

/**
 * Maps an unknown thrown/returned value from a Soroban simulation or submitted
 * transaction onto a typed `GiftEscrowError`.
 */
export function parseContractError(err: unknown): GiftEscrowError {
  const code = extractContractErrorCode(err);
  const known = code !== null ? CONTRACT_ERROR_MESSAGES[code] : undefined;

  if (known) {
    return new GiftEscrowError(known.code, known.message, code, err);
  }

  return new GiftEscrowError(
    'UNKNOWN_CONTRACT_ERROR',
    'The contract call could not be completed.',
    code,
    err,
  );
}

/** Matches the diagnostic-string form the host produces, e.g. `Error(Contract, #6)`. */
const CONTRACT_ERROR_STRING_PATTERN = /Error\(\s*Contract\s*,\s*#(\d+)\s*\)/i;

function findCodeInString(text: string): number | null {
  const match = CONTRACT_ERROR_STRING_PATTERN.exec(text);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Decodes a single `xdr.ContractEventV0`'s topics + data into a numeric contract
 * error code, if any of them is an `SCV_ERROR` of type `Contract`.
 *
 * `scValToNative` decodes that ScVal variant to `{ type: 'contract', code: number }`
 * (see `@stellar/stellar-base`'s `scValToNative`), which is the one place the raw
 * numeric `GiftEscrowError` value survives structurally, rather than only as a
 * human-readable diagnostic string.
 */
function codeFromContractEventV0(body: InstanceType<typeof xdrNs.ContractEventV0>): number | null {
  const scVals = [...body.topics(), body.data()];

  for (const scVal of scVals) {
    try {
      const native: unknown = scValToNative(scVal);
      if (
        typeof native === 'object' &&
        native !== null &&
        (native as { type?: unknown }).type === 'contract' &&
        typeof (native as { code?: unknown }).code === 'number'
      ) {
        return (native as { code: number }).code;
      }
    } catch {
      // Not every topic/data ScVal decodes cleanly (e.g. custom struct types) —
      // that's fine, it just means this particular value isn't an error code.
    }
  }

  return null;
}

function codeFromDiagnosticEvent(event: unknown): number | null {
  try {
    const diagnostic = event as InstanceType<typeof xdrNs.DiagnosticEvent>;
    const body = diagnostic.event().body();
    // `ContractEventBody` is currently a one-armed union (`v0`); guard defensively
    // in case a future protocol version adds arms this code doesn't know about.
    if (typeof (body as { v0?: unknown }).v0 !== 'function') return null;
    return codeFromContractEventV0((body as { v0(): InstanceType<typeof xdrNs.ContractEventV0> }).v0());
  } catch {
    return null;
  }
}

/** Normalizes the many shapes a caller might hand in into a list of diagnostic events. */
function extractDiagnosticEvents(err: unknown): unknown[] {
  if (typeof err !== 'object' || err === null) return [];

  const candidates = [
    (err as { diagnosticEventsXdr?: unknown }).diagnosticEventsXdr,
    (err as { diagnosticEvents?: unknown }).diagnosticEvents,
    (err as { events?: unknown }).events,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

/**
 * Parses the actual shape `@stellar/stellar-sdk` 13.x hands back for a failed
 * Soroban simulation or submitted transaction:
 *
 *  - `rpc.Api.SimulateTransactionErrorResponse.error` is a free-form diagnostic
 *    string produced by the host, typically containing a literal
 *    `Error(Contract, #N)` substring — checked first since it's the path
 *    `buildAndSimulate` (README §11.2) actually throws through.
 *  - `rpc.Api.GetFailedTransactionResponse` / `SendTransactionResponse` carry
 *    `diagnosticEventsXdr` (or the parsed `diagnosticEvents`/`events` fields),
 *    which are scanned for an `SCV_ERROR` ScVal via `scValToNative`.
 *  - A plain thrown `Error`'s message is checked last, as a catch-all for
 *    stringified errors from other layers of the stack.
 *
 * Returns `null` when no contract error code could be recovered — a real
 * possibility (a network error, a trapped-without-diagnostics failure) rather
 * than a bug in this function.
 */
export function extractContractErrorCode(err: unknown): number | null {
  if (err === null || err === undefined) return null;

  if (typeof (err as { error?: unknown }).error === 'string') {
    const found = findCodeInString((err as { error: string }).error);
    if (found !== null) return found;
  }

  for (const event of extractDiagnosticEvents(err)) {
    const found = codeFromDiagnosticEvent(event);
    if (found !== null) return found;
  }

  if (err instanceof Error) {
    const found = findCodeInString(err.message);
    if (found !== null) return found;
  }

  return null;
}
