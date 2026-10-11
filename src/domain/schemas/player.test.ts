import { describe, expect, it } from 'vitest';
import { PlayerSchema } from './player';

const valid = {
  id: '6f1c2b0e-8a4d-4c3e-9b1a-2d5e7f8a9b0c',
  name: 'Alice',
  createdAt: '2026-10-11T18:30:00.000Z',
};

describe('PlayerSchema', () => {
  it('accepts a valid player', () => {
    expect(PlayerSchema.parse(valid)).toEqual(valid);
  });

  it('trims the name', () => {
    expect(PlayerSchema.parse({ ...valid, name: '  Alice  ' }).name).toBe('Alice');
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(PlayerSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(PlayerSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('accepts a 100-char name and rejects a 101-char name', () => {
    expect(PlayerSchema.safeParse({ ...valid, name: 'a'.repeat(100) }).success).toBe(true);
    expect(PlayerSchema.safeParse({ ...valid, name: 'a'.repeat(101) }).success).toBe(false);
  });

  it('rejects an invalid id or createdAt', () => {
    expect(PlayerSchema.safeParse({ ...valid, id: 'alice' }).success).toBe(false);
    expect(PlayerSchema.safeParse({ ...valid, createdAt: 'yesterday' }).success).toBe(false);
  });
});
