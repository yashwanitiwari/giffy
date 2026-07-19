import { describe, expect, it } from 'vitest';

import { createGiftSchema } from '../src/validation/giftSchemas.js';

/**
 * The request schemas are the backend's authoritative gate (§7.3 principle 3), so
 * what they refuse matters as much as what they accept.
 */

const SENDER = 'GC4TO5T5Y43OP2IMOL62T5Y6PYIW4R2V7EYUQ3PHEXGZGFMVLUBW4OS6';
const RECEIVER = 'GD2MS5CHFG73PQSMUTVMO4XPSQDBSSDZLD2UKKMMFWGBW625BNNTDHXT';
const ISSUER = 'GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B';

const valid = {
  senderPublicKey: SENDER,
  receiverPublicKey: RECEIVER,
  assetCode: 'XLM',
  amount: '5.0000000',
  message: 'Happy birthday!',
  theme: 'birthday',
  expiresInSeconds: 3600,
};

const parse = (body: Record<string, unknown>) =>
  createGiftSchema.safeParse({ body, params: {}, query: {} });

describe('createGiftSchema', () => {
  it('accepts a well-formed native XLM gift', () => {
    expect(parse(valid).success).toBe(true);
  });

  it('accepts an issued asset with an issuer', () => {
    expect(parse({ ...valid, assetCode: 'SRT', assetIssuer: ISSUER }).success).toBe(true);
  });

  it('defaults isGroupGift to false and condition to none when omitted', () => {
    const result = parse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.isGroupGift).toBe(false);
      expect(result.data.body.condition).toEqual({ type: 'none' });
    }
  });

  describe('addresses', () => {
    it('rejects a malformed receiver', () => {
      expect(parse({ ...valid, receiverPublicKey: 'GNOTREAL' }).success).toBe(false);
    });

    it('rejects an address failing its StrKey checksum', () => {
      // Last character altered: right shape, wrong CRC — the case a `G...` regex
      // would wave through and the network would later reject.
      const typo = `${RECEIVER.slice(0, -1)}A`;
      expect(parse({ ...valid, receiverPublicKey: typo }).success).toBe(false);
    });

    it('rejects a secret key pasted where a public key belongs', () => {
      expect(
        parse({ ...valid, receiverPublicKey: 'SDJ4WDPOQAJYR3YIAJOJ6JOBQ4ZC6JI2BMDIBRKQIPGZ7GNKGVUFVE2K' })
          .success,
      ).toBe(false);
    });

    it('rejects gifting to yourself — an escrow with no counterparty', () => {
      expect(parse({ ...valid, receiverPublicKey: SENDER }).success).toBe(false);
    });
  });

  describe('amounts', () => {
    it.each([
      ['a number rather than a string', 5],
      ['zero', '0'],
      ['zero with decimals', '0.0000000'],
      ['negative', '-5'],
      ['more than 7 decimal places', '1.00000001'],
      ['non-numeric', 'abc'],
      ['exponential notation', '1e3'],
    ])('rejects %s', (_label, amount) => {
      expect(parse({ ...valid, amount }).success).toBe(false);
    });

    it('accepts an integer string', () => {
      expect(parse({ ...valid, amount: '5' }).success).toBe(true);
    });
  });

  describe('assets', () => {
    it('rejects an issuer on native XLM', () => {
      expect(parse({ ...valid, assetIssuer: ISSUER }).success).toBe(false);
    });

    it('rejects an issued asset with no issuer', () => {
      expect(parse({ ...valid, assetCode: 'SRT' }).success).toBe(false);
    });
  });

  describe('message', () => {
    it('rejects an over-long message regardless of any client-side cap', () => {
      expect(parse({ ...valid, message: 'x'.repeat(281) }).success).toBe(false);
    });

    it('accepts a message at exactly the cap', () => {
      expect(parse({ ...valid, message: 'x'.repeat(280) }).success).toBe(true);
    });

    it('rejects an empty message', () => {
      expect(parse({ ...valid, message: '' }).success).toBe(false);
    });
  });

  describe('expiry', () => {
    it.each([
      ['in the past', -1],
      ['zero', 0],
      ['below the one-minute floor', 30],
      ['beyond the one-year ceiling', 366 * 24 * 60 * 60],
      ['fractional', 1.5],
    ])('rejects an expiry %s', (_label, expiresInSeconds) => {
      expect(parse({ ...valid, expiresInSeconds }).success).toBe(false);
    });
  });

  describe('group gifting', () => {
    it('accepts isGroupGift with a goal amount', () => {
      expect(
        parse({ ...valid, isGroupGift: true, goalAmount: '100.0000000' }).success,
      ).toBe(true);
    });

    it('accepts isGroupGift with no goal amount', () => {
      expect(parse({ ...valid, isGroupGift: true }).success).toBe(true);
    });

    it('rejects a malformed goal amount', () => {
      expect(parse({ ...valid, isGroupGift: true, goalAmount: '0' }).success).toBe(false);
    });
  });

  describe('condition', () => {
    it('accepts a trivia condition', () => {
      expect(
        parse({
          ...valid,
          condition: { type: 'trivia', question: 'Where did we meet?', answer: 'the coffee shop' },
        }).success,
      ).toBe(true);
    });

    it('accepts a stepGate condition', () => {
      expect(
        parse({
          ...valid,
          condition: {
            type: 'stepGate',
            steps: [{ label: 'Step 1', description: 'Do the thing' }],
          },
        }).success,
      ).toBe(true);
    });

    it('rejects a trivia condition missing an answer', () => {
      expect(
        parse({ ...valid, condition: { type: 'trivia', question: 'Where?' } }).success,
      ).toBe(false);
    });

    it('rejects a stepGate condition with no steps', () => {
      expect(parse({ ...valid, condition: { type: 'stepGate', steps: [] } }).success).toBe(false);
    });

    it('rejects an unknown condition type', () => {
      expect(parse({ ...valid, condition: { type: 'somethingElse' } }).success).toBe(false);
    });
  });

  it('rejects unknown fields rather than silently ignoring them', () => {
    expect(parse({ ...valid, status: 'claimed' }).success).toBe(false);
  });

  it('rejects a mongo operator smuggled in where a string is expected', () => {
    expect(parse({ ...valid, senderPublicKey: { $ne: null } }).success).toBe(false);
  });
});
