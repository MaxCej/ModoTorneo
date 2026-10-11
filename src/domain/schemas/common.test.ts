import { describe, expect, it } from 'vitest';
import {
  FormatSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  TopCutSizeSchema,
  UuidSchema,
} from './common';

describe('UuidSchema', () => {
  it('accepts a crypto.randomUUID() value', () => {
    expect(UuidSchema.safeParse(crypto.randomUUID()).success).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    expect(UuidSchema.safeParse('player-1').success).toBe(false);
  });
});

describe('IsoDateTimeSchema', () => {
  it('accepts a UTC timestamp', () => {
    expect(IsoDateTimeSchema.safeParse('2026-10-11T18:30:00.000Z').success).toBe(true);
  });

  it('rejects a timestamp with an offset', () => {
    expect(IsoDateTimeSchema.safeParse('2026-10-11T15:30:00.000-03:00').success).toBe(false);
  });

  it('rejects a date without time', () => {
    expect(IsoDateTimeSchema.safeParse('2026-10-11').success).toBe(false);
  });
});

describe('IsoDateSchema', () => {
  it('accepts a calendar date', () => {
    expect(IsoDateSchema.safeParse('2026-10-11').success).toBe(true);
  });

  it('rejects an impossible date', () => {
    expect(IsoDateSchema.safeParse('2026-13-40').success).toBe(false);
  });
});

describe('FormatSchema', () => {
  it.each(['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'limited'])(
    'accepts %s',
    (format) => {
      expect(FormatSchema.safeParse(format).success).toBe(true);
    },
  );

  it('rejects an unknown format', () => {
    expect(FormatSchema.safeParse('brawl').success).toBe(false);
  });
});

describe('TopCutSizeSchema', () => {
  it.each([0, 4, 8])('accepts %i', (size) => {
    expect(TopCutSizeSchema.safeParse(size).success).toBe(true);
  });

  it.each([2, 16, '4'])('rejects %s', (size) => {
    expect(TopCutSizeSchema.safeParse(size).success).toBe(false);
  });
});
