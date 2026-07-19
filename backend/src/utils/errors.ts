/**
 * Domain errors for the API layer.
 *
 * These complement — never replace — `ChainError` from @giffy/chain: chain errors
 * describe what the *contract* refused (§11.5's `parseContractError` mapping table),
 * these describe what *Giffy* refused before ever reaching the network. Both carry a
 * stable `code` that `errorHandler` maps to an HTTP status and the frontend maps to
 * copy, so every failure the user can provoke has a specific, correct message
 * (README §7.3 principle 5).
 */

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'GIFT_NOT_FOUND'
  | 'GIFT_NOT_DRAFT'
  | 'GIFT_NOT_OPEN'
  | 'INVALID_GIFT_STATE'
  | 'CLAIM_EXPIRED'
  | 'NOT_CLAIMANT'
  | 'WRONG_ANSWER'
  | 'STEPS_NOT_COMPLETE'
  | 'NOT_STEP_GATED'
  | 'CONTRIBUTION_TOO_SMALL'
  | 'REFUND_NOT_ELIGIBLE'
  | 'SESSION_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  readonly code: ApiErrorCode = 'INTERNAL_ERROR';
  readonly status: number = 500;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends ApiError {
  override readonly code = 'VALIDATION_ERROR' as const;
  override readonly status = 400;
}

/**
 * Covers unknown, malformed, and never-existed claim tokens alike.
 *
 * The message is deliberately generic and identical in all three cases (§6.2): a
 * response that distinguished "expired" from "never existed" would confirm which
 * guesses in an enumeration sweep were real tokens.
 */
export class GiftNotFoundError extends ApiError {
  override readonly code = 'GIFT_NOT_FOUND' as const;
  override readonly status = 404;

  constructor(details?: unknown) {
    super("This gift link isn't valid.", details);
  }
}

/** A build/submit-create call against a gift that isn't `draft`/`pending_chain`. */
export class GiftNotDraftError extends ApiError {
  override readonly code = 'GIFT_NOT_DRAFT' as const;
  override readonly status = 409;

  constructor(message = 'This gift has already been submitted.', details?: unknown) {
    super(message, details);
  }
}

/** Contribution, claim, or step-unlock attempted against a non-`active` gift. */
export class GiftNotOpenError extends ApiError {
  override readonly code = 'GIFT_NOT_OPEN' as const;
  override readonly status = 409;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/** A valid request whose action the gift's current state doesn't otherwise permit. */
export class InvalidGiftStateError extends ApiError {
  override readonly code = 'INVALID_GIFT_STATE' as const;
  override readonly status = 409;
}

/** Narrowly: the claim window has closed. 410 rather than 409 (§15.7). */
export class ClaimWindowExpiredError extends ApiError {
  override readonly code = 'CLAIM_EXPIRED' as const;
  override readonly status = 410;

  constructor(details?: unknown) {
    super("This gift's claim window has passed.", details);
  }
}

/**
 * The requester is not the account this gift names as receiver.
 *
 * Refused here rather than left to the contract: `claim` would reject it anyway
 * (`NotReceiver`), but surfacing it before ever building a transaction gives an
 * honest receiver on the wrong wallet a clearer message than a failed simulation
 * would.
 */
export class NotClaimantError extends ApiError {
  override readonly code = 'NOT_CLAIMANT' as const;
  override readonly status = 403;

  constructor(details?: unknown) {
    super('This gift can only be claimed by the wallet it was addressed to.', details);
  }
}

/** A trivia pre-check, or a claim attempt, with a wrong answer (§16.2). */
export class WrongAnswerError extends ApiError {
  override readonly code = 'WRONG_ANSWER' as const;
  override readonly status = 409;

  constructor(details?: unknown) {
    super("That answer isn't quite right — try again.", details);
  }
}

/** A claim attempted on a step-gated gift before every step is unlocked (§16.2). */
export class StepsNotCompleteError extends ApiError {
  override readonly code = 'STEPS_NOT_COMPLETE' as const;
  override readonly status = 409;

  constructor(details?: unknown) {
    super('Not all unlock steps have been completed yet.', details);
  }
}

/** An unlock-step call against a gift whose condition isn't `stepGate`. */
export class NotStepGatedError extends ApiError {
  override readonly code = 'NOT_STEP_GATED' as const;
  override readonly status = 409;

  constructor(details?: unknown) {
    super('This gift has no step-based condition.', details);
  }
}

/** A contribution below `MIN_CONTRIBUTION_AMOUNT` (§12.4, §17.7). */
export class ContributionTooSmallError extends ApiError {
  override readonly code = 'CONTRIBUTION_TOO_SMALL' as const;
  override readonly status = 409;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class RefundNotEligibleError extends ApiError {
  override readonly code = 'REFUND_NOT_ELIGIBLE' as const;
  override readonly status = 409;

  constructor(message = "This gift hasn't expired yet.", details?: unknown) {
    super(message, details);
  }
}

export class SessionNotFoundError extends ApiError {
  override readonly code = 'SESSION_NOT_FOUND' as const;
  override readonly status = 404;

  constructor(details?: unknown) {
    super('This on-ramp session is no longer valid. Please start again.', details);
  }
}
