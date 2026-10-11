import { describe, expect, it } from 'vitest';
import { newId } from './ids';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('returns a v4 UUID', () => {
    expect(newId()).toMatch(UUID_RE);
  });

  it('returns a different id on each call', () => {
    expect(newId()).not.toBe(newId());
  });
});
