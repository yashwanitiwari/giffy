import { Router } from 'express';

import * as giftController from '../controllers/giftController.js';
import { giftRoutesLimiter } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  buildRefundSchema,
  createGiftSchema,
  giftIdParamSchema,
  listGiftsSchema,
  submitSignedXdrSchema,
} from '../validation/giftSchemas.js';

/** Sender routes (README §12.9). */

export const giftRoutes = Router();

giftRoutes.use(giftRoutesLimiter);

giftRoutes.post('/', validateRequest(createGiftSchema), giftController.create);

giftRoutes.get('/', validateRequest(listGiftsSchema), giftController.listMine);

giftRoutes.post(
  '/:id/build-transaction',
  validateRequest(giftIdParamSchema),
  giftController.buildTransaction,
);

giftRoutes.post('/:id/submit', validateRequest(submitSignedXdrSchema), giftController.submit);

giftRoutes.post(
  '/:id/refund/build-transaction',
  validateRequest(buildRefundSchema),
  giftController.buildRefund,
);

giftRoutes.post(
  '/:id/refund/submit',
  validateRequest(submitSignedXdrSchema),
  giftController.submitRefund,
);
