import { Router } from 'express';

import * as claimController from '../controllers/claimController.js';
import { claimPreviewLimiter } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  buildClaimSchema,
  claimTokenSchema,
  submitClaimSchema,
  verifyAnswerSchema,
} from '../validation/giftSchemas.js';

/**
 * Receiver routes (README §12.9).
 *
 * Public and unauthenticated — a claim link is a URL that ends up in a text message.
 * The stricter limiter is applied to the whole router rather than only the preview:
 * every leg here resolves the same token, so limiting only the read would leave an
 * equally good oracle one route over.
 */

export const claimRoutes = Router();

claimRoutes.use(claimPreviewLimiter);

claimRoutes.get('/:token', validateRequest(claimTokenSchema), claimController.preview);

claimRoutes.post(
  '/:token/verify-answer',
  validateRequest(verifyAnswerSchema),
  claimController.verifyAnswer,
);

claimRoutes.post(
  '/:token/build-transaction',
  validateRequest(buildClaimSchema),
  claimController.buildTransaction,
);

claimRoutes.post('/:token/submit', validateRequest(submitClaimSchema), claimController.submit);
