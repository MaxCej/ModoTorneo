import { z } from 'zod';

/** Generated with `crypto.randomUUID()`. */
export const UuidSchema = z.uuid();
export type Uuid = z.infer<typeof UuidSchema>;

/** UTC timestamp, e.g. `2026-10-11T18:30:00.000Z`. Offsets are rejected. */
export const IsoDateTimeSchema = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** Calendar date, e.g. `2026-10-11`. */
export const IsoDateSchema = z.iso.date();
export type IsoDate = z.infer<typeof IsoDateSchema>;

export const FormatSchema = z.enum([
  'standard',
  'pioneer',
  'modern',
  'legacy',
  'vintage',
  'pauper',
  'commander',
  'limited',
]);
export type Format = z.infer<typeof FormatSchema>;

/** 0 = no top cut. */
export const TopCutSizeSchema = z.union([z.literal(0), z.literal(4), z.literal(8)]);
export type TopCutSize = z.infer<typeof TopCutSizeSchema>;
