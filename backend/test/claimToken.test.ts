import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  claimTokenHashEquals,
  generateClaimToken,
  hashClaimToken,
  isWellFormedClaimToken,
} from '../src/utils/claimToken.js';
import { buildClaimUrl } from '../src/utils/qrPayload.js';

/**
 * Claim tokens are the only thing standing between a public URL and someone else's
 * gift preview, so the properties §15.2 asks for are pinned here rather than assumed.
 */

describe('generateClaimToken', () => {
  it('is URL-safe', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateClaimToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('carries the configured entropy', () => {
    // 32 bytes → 43 base64url chars (no padding).
    expect(generateClaimToken()).toHaveLength(43);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 1_000 }, generateClaimToken));
    expect(seen.size).toBe(1_000);
  });
});

describe('hashClaimToken', () => {
  it('is SHA-256 hex', () => {
    expect(hashClaimToken('hello')).toBe(
      createHash('sha256').update('hello', 'utf8').digest('hex'),
    );
  });

  it('is deterministic', () => {
    const token = generateClaimToken();
    expect(hashClaimToken(token)).toBe(hashClaimToken(token));
  });

  it('never returns the token itself — the preimage must not be recoverable', () => {
    const token = generateClaimToken();
    expect(hashClaimToken(token)).not.toContain(token);
  });
});

describe('isWellFormedClaimToken', () => {
  it('accepts a real token', () => {
    expect(isWellFormedClaimToken(generateClaimToken())).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['path traversal', '../../etc/passwd'],
    ['query injection', 'abc?foo=bar'],
    ['mongo operator object', { $ne: null }],
    ['null', null],
    ['number', 12345],
    ['overlong', 'a'.repeat(129)],
  ])('rejects %s', (_label, value) => {
    expect(isWellFormedClaimToken(value)).toBe(false);
  });
});

describe('claimTokenHashEquals', () => {
  it('matches identical digests', () => {
    const hash = hashClaimToken('a');
    expect(claimTokenHashEquals(hash, hash)).toBe(true);
  });

  it('rejects different digests', () => {
    expect(claimTokenHashEquals(hashClaimToken('a'), hashClaimToken('b'))).toBe(false);
  });

  it('returns false rather than throwing on a length mismatch', () => {
    // timingSafeEqual throws on unequal lengths; this must not surface as a 500.
    expect(claimTokenHashEquals(hashClaimToken('a'), 'short')).toBe(false);
  });
});

describe('buildClaimUrl', () => {
  it('joins base and token without a double slash', () => {
    expect(buildClaimUrl('abc')).toBe('http://localhost:3000/claim/abc');
  });
});
