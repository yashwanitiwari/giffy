import { assertValidPublicKey } from '@giffy/chain';
import { z } from 'zod';

/** Request schemas for the group-contribution routes (README §15.2). */

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

const stellarAmount = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, 'Expected a decimal amount with at most 7 decimal places.')
  .refine((value) => !/^0(\.0{1,7})?$/.test(value), 'Amount must be greater than zero.');

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid id.');

export const giftIdParamSchema = z.object({
  params: z.object({ id: objectIdParam }),
});

export const contributeSchema = z.object({
  params: z.object({ id: objectIdParam }),
  body: z
    .object({
      contributorPublicKey: stellarPublicKey,
      amount: stellarAmount,
    })
    .strict(),
});

export const contributeSubmitSchema = z.object({
  params: z.object({ id: objectIdParam }),
  body: z
    .object({
      contributorPublicKey: stellarPublicKey,
      amount: stellarAmount,
      signedXdr: z.string().min(1),
    })
    .strict(),
});
