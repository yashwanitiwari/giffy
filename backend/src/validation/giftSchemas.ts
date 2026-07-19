import { assertValidPublicKey } from '@giffy/chain';
import { z } from 'zod';

import { env } from '../config/env.js';
import { GIFT_THEMES } from '../models/Gift.js';
import { isWellFormedClaimToken } from '../utils/claimToken.js';

/**
 * Request schemas for the gift and claim routes (README §15.1, §15.4, §15.5).
 *
 * Every check here is duplicated by the frontend for UX and re-run by the contract
 * at submit time. That is the intent, not redundancy: client-side validation is a
 * courtesy, this layer is authoritative for what the backend will act on, and the
 * contract is authoritative for what actually happens (README §7.3 principle 3).
 */

/**
 * Address validation delegated to the chain layer rather than reimplemented as a
 * `G...` regex — StrKey carries a CRC-16 checksum, so a regex would happily accept a
 * single-character typo that the network then rejects, after the sender has already
 * locked funds toward it.
 */
const stellarPublicKey = z.string().superRefine((value, ctx) => {
  try {
    assertValidPublicKey(value);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Not a well-formed Stellar public key.',
    });
  }
});

/** Positive decimal string, max 7 dp — never a number. */
const stellarAmount = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, 'Expected a decimal amount with at most 7 decimal places.')
  .refine((value) => !/^0(\.0{1,7})?$/.test(value), 'Amount must be greater than zero.');

const assetCode = z
  .string()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9]+$/, 'Asset codes are alphanumeric, 1-12 characters.');

const claimTokenParam = z.string().refine(isWellFormedClaimToken, 'Invalid claim token.');

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid id.');

/** One year. Long enough for any plausible gift, short enough to bound a typo. */
const MAX_EXPIRY_SECONDS = 365 * 24 * 60 * 60;

/** One minute. Below this, the gift would expire before a receiver could act. */
const MIN_EXPIRY_SECONDS = 60;

const conditionStep = z
  .object({
    label: z.string().min(1).max(120),
    description: z.string().min(1).max(280),
  })
  .strict();

/** Discriminated union mirroring the contract's `ClaimCondition` enum (README §4.1, §15.1). */
const conditionInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z
    .object({
      type: z.literal('trivia'),
      question: z.string().min(1).max(280),
      answer: z.string().min(1).max(280),
    })
    .strict(),
  z
    .object({
      type: z.literal('stepGate'),
      steps: z.array(conditionStep).min(1).max(20),
      stepUnlockerPublicKey: stellarPublicKey.nullish(),
    })
    .strict(),
]);

export const createGiftSchema = z.object({
  body: z
    .object({
      senderPublicKey: stellarPublicKey,
      receiverPublicKey: stellarPublicKey,
      assetCode,
      assetIssuer: stellarPublicKey.nullish(),
      amount: stellarAmount,
      message: z.string().min(1).max(env.GIFT_MESSAGE_MAX_LENGTH),
      theme: z.enum(GIFT_THEMES),
      expiresInSeconds: z.number().int().min(MIN_EXPIRY_SECONDS).max(MAX_EXPIRY_SECONDS),
      isGroupGift: z.boolean().default(false),
      goalAmount: stellarAmount.nullish(),
      condition: conditionInput.default({ type: 'none' }),
    })
    .strict()
    .refine((body) => body.senderPublicKey !== body.receiverPublicKey, {
      message: 'A gift cannot be sent to the sending account itself.',
      path: ['receiverPublicKey'],
    })
    .refine((body) => body.assetCode !== 'XLM' || !body.assetIssuer, {
      message: 'Native XLM has no issuer.',
      path: ['assetIssuer'],
    })
    .refine((body) => body.assetCode === 'XLM' || Boolean(body.assetIssuer), {
      message: 'An issuer is required for any asset other than XLM.',
      path: ['assetIssuer'],
    }),
});

export const giftIdParamSchema = z.object({
  params: z.object({ id: objectIdParam }),
});

export const submitSignedXdrSchema = z.object({
  params: z.object({ id: objectIdParam }),
  body: z.object({ signedXdr: z.string().min(1) }).strict(),
});

/**
 * Refund build takes the caller's key rather than a signed XDR: it is the leg that
 * asks "which account is reclaiming?" so the transaction can be built against it.
 * Any contributor or the sender may be the caller (README §15.5, §17.4).
 */
export const buildRefundSchema = z.object({
  params: z.object({ id: objectIdParam }),
  body: z.object({ callerPublicKey: stellarPublicKey }).strict(),
});

export const listGiftsSchema = z.object({
  query: z.object({ senderPublicKey: stellarPublicKey }),
});

export const claimTokenSchema = z.object({
  params: z.object({ token: claimTokenParam }),
});

export const verifyAnswerSchema = z.object({
  params: z.object({ token: claimTokenParam }),
  body: z.object({ answer: z.string().min(1).max(280) }).strict(),
});

export const buildClaimSchema = z.object({
  params: z.object({ token: claimTokenParam }),
  body: z
    .object({
      claimantPublicKey: stellarPublicKey,
      // Present only when `condition.type === 'trivia'` (README §15.4).
      answer: z.string().min(1).max(280).nullish(),
    })
    .strict(),
});

export const submitClaimSchema = z.object({
  params: z.object({ token: claimTokenParam }),
  body: z.object({ signedXdr: z.string().min(1) }).strict(),
});

export type CreateGiftInput = z.infer<typeof createGiftSchema>['body'];
