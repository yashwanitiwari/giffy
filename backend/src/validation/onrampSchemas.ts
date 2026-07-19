import { assertValidPublicKey } from '@giffy/chain';
import { z } from 'zod';

/** Request schemas for the SEP-10/SEP-24 on-ramp routes (README §13.3). */

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

/** Opaque session reference minted by this backend — never the anchor's JWT (§15.7). */
const sessionToken = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, 'Invalid session token.');

export const challengeSchema = z.object({
  body: z.object({ publicKey: stellarPublicKey }).strict(),
});

export const submitChallengeSchema = z.object({
  body: z
    .object({
      publicKey: stellarPublicKey,
      signedXdr: z.string().min(1),
    })
    .strict(),
});

export const initiateDepositSchema = z.object({
  body: z
    .object({
      sessionToken,
      assetCode: z
        .string()
        .min(1)
        .max(12)
        .regex(/^[A-Za-z0-9]+$/, 'Asset codes are alphanumeric, 1-12 characters.'),
    })
    .strict(),
});

export const depositStatusSchema = z.object({
  params: z.object({ id: z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid session id.') }),
});
