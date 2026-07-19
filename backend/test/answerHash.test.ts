import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashAnswer } from '../src/services/conditionService.js';

/**
 * Trivia answers are hashed the same way on both sides of the system — this
 * backend document and the contract's own `AnswerHash` condition (README §12.5) —
 * so the normalization rules pinned here matter: a mismatch here is a correct
 * answer that fails to claim.
 */

describe('hashAnswer', () => {
  it('is SHA-256 hex of the trimmed, lowercased answer', () => {
    expect(hashAnswer('Hello')).toBe(createHash('sha256').update('hello').digest('hex'));
  });

  it('is case-insensitive', () => {
    expect(hashAnswer('The Coffee Shop')).toBe(hashAnswer('the coffee shop'));
  });

  it('ignores leading/trailing whitespace', () => {
    expect(hashAnswer('  the coffee shop  ')).toBe(hashAnswer('the coffee shop'));
  });

  it('does not ignore internal whitespace differences', () => {
    expect(hashAnswer('the  coffee shop')).not.toBe(hashAnswer('the coffee shop'));
  });

  it('is deterministic', () => {
    expect(hashAnswer('answer')).toBe(hashAnswer('answer'));
  });

  it('produces different hashes for different answers', () => {
    expect(hashAnswer('answer one')).not.toBe(hashAnswer('answer two'));
  });
});
