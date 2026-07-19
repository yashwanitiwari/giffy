import { ChainError, GiftEscrowError } from '@giffy/chain';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  ClaimWindowExpiredError,
  GiftNotFoundError,
  NotClaimantError,
  RefundNotEligibleError,
  StepsNotCompleteError,
  WrongAnswerError,
} from '../src/utils/errors.js';

/**
 * The boundary where thrown errors become HTTP. Worth pinning: these mappings are
 * what let the frontend distinguish "too late" from "not yet" from "not your gift",
 * and a wrong status here reads to a user as the wrong sentence.
 */

function run(err: unknown): { status: number; body: any } {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const req = { method: 'POST', originalUrl: '/api/test' } as Request;

  errorHandler(err, req, res as unknown as Response, vi.fn() as NextFunction);

  return {
    status: res.status.mock.calls[0]![0] as number,
    body: res.json.mock.calls[0]![0],
  };
}

describe('errorHandler', () => {
  describe('Giffy refusals', () => {
    it.each([
      ['unknown claim token → 404', new GiftNotFoundError(), 404, 'GIFT_NOT_FOUND'],
      ['wrong wallet → 403', new NotClaimantError(), 403, 'NOT_CLAIMANT'],
      ['claim after expiry → 410', new ClaimWindowExpiredError(), 410, 'CLAIM_EXPIRED'],
      ['refund before expiry → 409', new RefundNotEligibleError(), 409, 'REFUND_NOT_ELIGIBLE'],
      ['wrong trivia answer → 409', new WrongAnswerError(), 409, 'WRONG_ANSWER'],
      ['steps incomplete → 409', new StepsNotCompleteError(), 409, 'STEPS_NOT_COMPLETE'],
    ])('%s', (_l, err, status, code) => {
      const res = run(err);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    });
  });

  describe('contract refusals', () => {
    it.each([
      ['expired claim → 410', new GiftEscrowError('GIFT_EXPIRED', 'too late', 3), 410, 'GIFT_EXPIRED'],
      [
        'early refund → 409',
        new GiftEscrowError('GIFT_NOT_YET_EXPIRED', 'too early', 4),
        409,
        'GIFT_NOT_YET_EXPIRED',
      ],
      [
        'not the receiver → 403',
        new GiftEscrowError('NOT_RECEIVER', 'not yours', 5),
        403,
        'NOT_RECEIVER',
      ],
      ['generic chain error → 400', new ChainError('nope'), 400, 'CHAIN_ERROR'],
      [
        'unrecognized contract code → 400',
        new GiftEscrowError('SOME_NEW_CODE' as never, 'huh', null),
        400,
        'SOME_NEW_CODE',
      ],
    ])('%s', (_l, err, status, code) => {
      const res = run(err);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    });

    it('surfaces the chain error message, since it is written for a human', () => {
      expect(
        run(new GiftEscrowError('GIFT_EXPIRED', 'This gift has passed.', 3)).body.error.message,
      ).toBe('This gift has passed.');
    });

    it('never leaks a raw network payload carried in `details`', () => {
      const raw = { extras: { result_codes: { operations: ['op_underfunded'] } } };
      const body = run(new ChainError('Not enough funds.', raw)).body;

      expect(JSON.stringify(body)).not.toContain('result_codes');
      expect(body.error).not.toHaveProperty('details');
    });
  });

  describe('unexpected errors', () => {
    it('becomes an opaque 500 rather than echoing internals', () => {
      const res = run(new Error('MongoServerError: auth failed for user giffy@cluster0'));

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('cluster0');
    });

    it('handles a non-Error throw', () => {
      expect(run('a bare string').status).toBe(500);
    });
  });

  it('always returns the documented { error: { code, message } } envelope', () => {
    for (const err of [new GiftNotFoundError(), new ChainError('x'), new Error('y'), null]) {
      const body = run(err).body;
      expect(body.error).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
      });
    }
  });
});
