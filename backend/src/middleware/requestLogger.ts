import { pinoHttp } from 'pino-http';

import { logger } from '../utils/logger.js';

/**
 * Per-request structured logging (README §10.2).
 *
 * `serializers.req` is narrowed deliberately: pino-http's default logs the full URL,
 * which for `GET /api/claim/:token` would write live claim tokens into every log line
 * — a raw token must never be logged (§15.2), and a log file full of them is a log
 * file full of claimable gifts. The path is rewritten to its route shape, keeping the
 * operational signal (which endpoint, how often, how slow) without the secret.
 */
export const requestLogger = pinoHttp({
  logger,
  autoLogging: {
    // Health checks are the noisiest thing a load balancer does and the least
    // interesting thing in a log.
    ignore: (req) => req.url === '/api/health',
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: redactClaimToken(req.url),
      remoteAddress: req.remoteAddress,
    }),
  },
});

const CLAIM_PATH = /^(\/api\/claim\/)[^/?]+/;

function redactClaimToken(url: string): string {
  return url.replace(CLAIM_PATH, '$1:token');
}
