import { pino } from 'pino';

import { env, isProduction } from '../config/env.js';

/**
 * Structured JSON logging (README §10.2), so logs stay queryable in any hosting
 * environment rather than being human-shaped strings nothing can index.
 *
 * `redact` is the backstop for the two secrets that flow through this process and
 * must never reach a log line: raw claim tokens (§15.2 — only their hash is ever
 * persisted, and a token in a log file is a claimable gift in a log file) and the
 * anchor's SEP-10 JWT (§15.7). Call sites are expected not to log these at all;
 * this catches the case where one slips into an error payload or request object.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'token',
      '*.token',
      'claimToken',
      '*.claimToken',
      'anchorJwt',
      '*.anchorJwt',
      'jwt',
      '*.jwt',
      'req.params.token',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[redacted]',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});
