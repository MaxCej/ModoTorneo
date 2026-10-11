import { z } from 'zod';
import {
  FormatSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  TopCutSizeSchema,
  UuidSchema,
} from './common';
import { MatchResultSchema } from './matchResult';

const RoundNumberSchema = z.number().int().min(1);

/** Wraps a payload schema in the common event envelope. */
function eventSchema<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({
    id: UuidSchema,
    seq: z.number().int().min(1),
    at: IsoDateTimeSchema,
    type: z.literal(type),
    payload,
  });
}

export const PairingSchema = z.object({
  matchId: UuidSchema,
  table: z.number().int().min(1),
  playerA: UuidSchema,
  playerB: UuidSchema.nullable(), // null = bye
});
export type Pairing = z.infer<typeof PairingSchema>;

export const TournamentCreatedPayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
  date: IsoDateSchema,
  location: z.string().trim().max(100),
  format: FormatSchema,
  swissRounds: RoundNumberSchema,
});
export type TournamentCreatedPayload = z.infer<typeof TournamentCreatedPayloadSchema>;

export const PlayerRegisteredPayloadSchema = z.object({
  playerId: UuidSchema,
  playerName: z.string().trim().min(1).max(100),
  deckId: UuidSchema.optional(),
});
export type PlayerRegisteredPayload = z.infer<typeof PlayerRegisteredPayloadSchema>;

export const PlayerDroppedPayloadSchema = z.object({ playerId: UuidSchema });
export type PlayerDroppedPayload = z.infer<typeof PlayerDroppedPayloadSchema>;

export const RoundPairedPayloadSchema = z.object({
  round: RoundNumberSchema,
  stage: z.enum(['swiss', 'topCut']),
  pairings: z.array(PairingSchema),
});
export type RoundPairedPayload = z.infer<typeof RoundPairedPayloadSchema>;

export const ResultReportedPayloadSchema = z.object({
  matchId: UuidSchema,
  result: MatchResultSchema,
});
export type ResultReportedPayload = z.infer<typeof ResultReportedPayloadSchema>;

export const RoundClosedPayloadSchema = z.object({ round: RoundNumberSchema });
export type RoundClosedPayload = z.infer<typeof RoundClosedPayloadSchema>;

export const TopCutStartedPayloadSchema = z.object({
  size: TopCutSizeSchema,
});
export type TopCutStartedPayload = z.infer<typeof TopCutStartedPayloadSchema>;

export const TournamentFinishedPayloadSchema = z.record(z.string(), z.never());
export type TournamentFinishedPayload = z.infer<typeof TournamentFinishedPayloadSchema>;

export const RolledBackPayloadSchema = z.object({ toSeq: z.number().int().min(1) });
export type RolledBackPayload = z.infer<typeof RolledBackPayloadSchema>;

export const TournamentCreatedSchema = eventSchema(
  'TournamentCreated',
  TournamentCreatedPayloadSchema,
);
export const PlayerRegisteredSchema = eventSchema(
  'PlayerRegistered',
  PlayerRegisteredPayloadSchema,
);
export const PlayerDroppedSchema = eventSchema('PlayerDropped', PlayerDroppedPayloadSchema);
export const RoundPairedSchema = eventSchema('RoundPaired', RoundPairedPayloadSchema);
export const ResultReportedSchema = eventSchema('ResultReported', ResultReportedPayloadSchema);
export const RoundClosedSchema = eventSchema('RoundClosed', RoundClosedPayloadSchema);
export const TopCutStartedSchema = eventSchema('TopCutStarted', TopCutStartedPayloadSchema);
export const TournamentFinishedSchema = eventSchema(
  'TournamentFinished',
  TournamentFinishedPayloadSchema,
);
export const RolledBackSchema = eventSchema('RolledBack', RolledBackPayloadSchema);

export type TournamentCreated = z.infer<typeof TournamentCreatedSchema>;
export type PlayerRegistered = z.infer<typeof PlayerRegisteredSchema>;
export type PlayerDropped = z.infer<typeof PlayerDroppedSchema>;
export type RoundPaired = z.infer<typeof RoundPairedSchema>;
export type ResultReported = z.infer<typeof ResultReportedSchema>;
export type RoundClosed = z.infer<typeof RoundClosedSchema>;
export type TopCutStarted = z.infer<typeof TopCutStartedSchema>;
export type TournamentFinished = z.infer<typeof TournamentFinishedSchema>;
export type RolledBack = z.infer<typeof RolledBackSchema>;

export const TournamentEventSchema = z.discriminatedUnion('type', [
  TournamentCreatedSchema,
  PlayerRegisteredSchema,
  PlayerDroppedSchema,
  RoundPairedSchema,
  ResultReportedSchema,
  RoundClosedSchema,
  TopCutStartedSchema,
  TournamentFinishedSchema,
  RolledBackSchema,
]);
export type TournamentEvent = z.infer<typeof TournamentEventSchema>;
export type TournamentEventType = TournamentEvent['type'];
