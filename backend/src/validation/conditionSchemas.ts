import { assertValidPublicKey } from '@giffy/chain';
import { z } from 'zod';

/** Request schemas for the step-gate unlock routes (README §15.3). */

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

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid id.');

export const buildUnlockStepSchema = z.object({
  params: z.object({ id: objectIdParam }),
  body: z.object({ unlockerPublicKey: stellarPublicKey }).strict(),
});

export const submitUnlockStepSchema = z.object({
  params: z.object({ id: objectIdParam }),
  body: z.object({ signedXdr: z.string().min(1) }).strict(),
});
