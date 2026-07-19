import { describe, expect, it } from 'vitest';

import {
  AccountNotFoundError,
  BadSequenceError,
  BalanceNotFoundError,
  ChainError,
  ClaimExpiredError,
  ClaimNotYetAvailableError,
  InsufficientBalanceError,
  TrustlineMissingError,
  parseHorizonError,
} from '../src/errors.js';
import { CANNOT_CLAIM_ERROR } from './fixtures.js';

/**
 * Every result code asserted here was observed coming back from live testnet
 * Horizon while building this layer, rather than recalled from documentation.
 */
function horizonError(resultCodes: { transaction?: string; operations?: string[] }): unknown {
  return {
    response: {
      status: 400,
      data: {
        type: 'https://stellar.org/horizon-errors/transaction_failed',
        title: 'Transaction Failed',
        status: 400,
        extras: { result_codes: resultCodes },
      },
    },
  };
}

describe('parseHorizonError', () => {
  it('maps an underfunded source account', () => {
    const err = parseHorizonError(
      horizonError({ transaction: 'tx_failed', operations: ['op_underfunded'] }),
    );

    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(err.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('maps a missing trustline', () => {
    const err = parseHorizonError(
      horizonError({ transaction: 'tx_failed', operations: ['op_no_trust'] }),
    );

    expect(err).toBeInstanceOf(TrustlineMissingError);
    expect(err.code).toBe('TRUSTLINE_MISSING');
  });

  it('maps a bad sequence number', () => {
    const err = parseHorizonError(horizonError({ transaction: 'tx_bad_seq' }));

    expect(err).toBeInstanceOf(BadSequenceError);
    expect(err.message).toMatch(/stale sequence number/i);
  });

  it('maps a claim against a balance that no longer exists', () => {
    const err = parseHorizonError(
      horizonError({ transaction: 'tx_failed', operations: ['op_does_not_exist'] }),
    );

    expect(err).toBeInstanceOf(BalanceNotFoundError);
  });

  it('maps a missing source account', () => {
    const err = parseHorizonError(horizonError({ transaction: 'tx_no_source_account' }));

    expect(err).toBeInstanceOf(AccountNotFoundError);
  });

  it('maps a low reserve to an insufficient-balance error', () => {
    const err = parseHorizonError(
      horizonError({ transaction: 'tx_failed', operations: ['op_low_reserve'] }),
    );

    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(err.message).toMatch(/reserve/i);
  });

  describe('op_cannot_claim', () => {
    /**
     * Horizon returns one code for every reason a claim cannot proceed, so intent
     * is what turns it into the right message — the difference between telling a
     * receiver "you're too late" and a sender "it's too early".
     */
    it("reads as expired for a receiver's claim", () => {
      const err = parseHorizonError(CANNOT_CLAIM_ERROR, 'receive');

      expect(err).toBeInstanceOf(ClaimExpiredError);
      expect(err.code).toBe('CLAIM_EXPIRED');
      expect(err.message).toMatch(/claim window has passed/i);
    });

    it("reads as not-yet-available for a sender's reclaim", () => {
      const err = parseHorizonError(CANNOT_CLAIM_ERROR, 'refund');

      expect(err).toBeInstanceOf(ClaimNotYetAvailableError);
      expect(err.code).toBe('CLAIM_NOT_YET_AVAILABLE');
      expect(err.message).toMatch(/not expired yet/i);
    });

    it('defaults to the receiver reading when no intent is given', () => {
      expect(parseHorizonError(CANNOT_CLAIM_ERROR)).toBeInstanceOf(ClaimExpiredError);
    });
  });

  it('ignores op_success and reports the operation that actually failed', () => {
    // A batched trustline + claim where the trustline succeeded and the claim did
    // not: the first op's success must not mask the second op's failure.
    const err = parseHorizonError(
      horizonError({ transaction: 'tx_failed', operations: ['op_success', 'op_cannot_claim'] }),
      'receive',
    );

    expect(err).toBeInstanceOf(ClaimExpiredError);
  });

  it('falls back to a generic ChainError for an unrecognized code, keeping the detail', () => {
    const err = parseHorizonError(
      horizonError({ transaction: 'tx_failed', operations: ['op_some_future_code'] }),
    );

    expect(err).toBeInstanceOf(ChainError);
    expect(err.code).toBe('CHAIN_ERROR');
    expect(err.message).toContain('op_some_future_code');
  });

  it('passes an already-typed ChainError through untouched', () => {
    const original = new ClaimExpiredError('This gift expired.');

    expect(parseHorizonError(original)).toBe(original);
  });

  it('maps a bare 404 to a not-found error', () => {
    expect(parseHorizonError({ response: { status: 404, data: {} } })).toBeInstanceOf(
      AccountNotFoundError,
    );
  });

  it('wraps a plain Error', () => {
    const err = parseHorizonError(new Error('socket hang up'));

    expect(err).toBeInstanceOf(ChainError);
    expect(err.message).toBe('socket hang up');
  });

  it('wraps a non-error value without throwing', () => {
    expect(parseHorizonError('something odd')).toBeInstanceOf(ChainError);
    expect(parseHorizonError(null)).toBeInstanceOf(ChainError);
    expect(parseHorizonError(undefined)).toBeInstanceOf(ChainError);
  });

  it('keeps the raw payload on details for server-side logging only', () => {
    const err = parseHorizonError(CANNOT_CLAIM_ERROR);

    // The backend logs `details` and returns only `message` to the client, so raw
    // Horizon payloads never leak into a response body (README §10.6).
    expect(err.details).toBeDefined();
    expect(err.message).not.toContain('result_xdr');
  });
});
