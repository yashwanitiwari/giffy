import { Router } from 'express';

import * as onrampController from '../controllers/onrampController.js';
import { giftRoutesLimiter } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  challengeSchema,
  depositStatusSchema,
  initiateDepositSchema,
  submitChallengeSchema,
} from '../validation/onrampSchemas.js';

/**
 * On-ramp routes (README §10.5).
 *
 * The status route is polled every few seconds by an open modal (§6.1 step 2), so it
 * lives under the lenient limiter — the strict one would throttle a user for waiting.
 */

export const onrampRoutes = Router();

onrampRoutes.use(giftRoutesLimiter);

onrampRoutes.post('/sep10-challenge', validateRequest(challengeSchema), onrampController.challenge);

onrampRoutes.post(
  '/sep10-submit',
  validateRequest(submitChallengeSchema),
  onrampController.submitChallenge,
);

onrampRoutes.post(
  '/sep24-deposit',
  validateRequest(initiateDepositSchema),
  onrampController.initiateDeposit,
);

onrampRoutes.get(
  '/sep24-status/:id',
  validateRequest(depositStatusSchema),
  onrampController.status,
);
