import { z } from 'zod';
import {
  BestOfSchema,
  FormatSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  TopCutSizeSchema,
  UuidSchema,
} from './common';
import { DeckSchema } from './deck';
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

const TournamentNameSchema = z.string().trim().min(1).max(100);
const LocationSchema = z.string().trim().max(100);
const SwissRoundsSchema = RoundNumberSchema.nullable(); // null = auto

export const TournamentCreatedPayloadSchema = z.object({
  name: TournamentNameSchema,
  date: IsoDateSchema,
  location: LocationSchema,
  format: FormatSchema,
  swissRounds: SwissRoundsSchema, // null is fixed by the first swiss RoundPaired
});
export type TournamentCreatedPayload = z.infer<typeof TournamentCreatedPayloadSchema>;

export const PlayerRegisteredPayloadSchema = z.object({
  playerId: UuidSchema,
  playerName: z.string().trim().min(1).max(100),
  deckId: UuidSchema.optional(),
  guest: z.boolean().optional(), // missing = false. Guests are never added to the global registry.
});
export type PlayerRegisteredPayload = z.infer<typeof PlayerRegisteredPayloadSchema>;

/** Partial edit of the tournament details. At least one field is present. */
export const TournamentDetailsChangedPayloadSchema = z
  .object({
    name: TournamentNameSchema.optional(),
    date: IsoDateSchema.optional(),
    location: LocationSchema.optional(),
    format: FormatSchema.optional(),
    swissRounds: SwissRoundsSchema.optional(), // null = back to auto
  })
  .refine((payload) => Object.values(payload).some((value) => value !== undefined), {
    message: 'At least one detail must change',
  });
export type TournamentDetailsChangedPayload = z.infer<typeof TournamentDetailsChangedPayloadSchema>;

export const PlayerDroppedPayloadSchema = z.object({ playerId: UuidSchema });
export type PlayerDroppedPayload = z.infer<typeof PlayerDroppedPayloadSchema>;

export const PlayerUnregisteredPayloadSchema = z.object({ playerId: UuidSchema });
export type PlayerUnregisteredPayload = z.infer<typeof PlayerUnregisteredPayloadSchema>;

export const RoundPairedPayloadSchema = z.object({
  round: RoundNumberSchema,
  stage: z.enum(['swiss', 'topCut']),
  pairings: z.array(PairingSchema),
});
export type RoundPairedPayload = z.infer<typeof RoundPairedPayloadSchema>;

/** Two players in the open swiss round trade seats. */
export const PlayersSwappedPayloadSchema = z.object({
  round: RoundNumberSchema,
  playerA: UuidSchema,
  playerB: UuidSchema,
});
export type PlayersSwappedPayload = z.infer<typeof PlayersSwappedPayloadSchema>;

export const ResultReportedPayloadSchema = z.object({
  matchId: UuidSchema,
  result: MatchResultSchema,
});
export type ResultReportedPayload = z.infer<typeof ResultReportedPayloadSchema>;

export const RoundClosedPayloadSchema = z.object({ round: RoundNumberSchema });
export type RoundClosedPayload = z.infer<typeof RoundClosedPayloadSchema>;

export const TopCutStartedPayloadSchema = z.object({
  size: TopCutSizeSchema,
  bestOf: BestOfSchema.optional(), // missing = 3 (documents written before SPEC 08)
});
export type TopCutStartedPayload = z.infer<typeof TopCutStartedPayloadSchema>;

export const TournamentFinishedPayloadSchema = z.record(z.string(), z.never());
export type TournamentFinishedPayload = z.infer<typeof TournamentFinishedPayloadSchema>;

/** The player's deck in this tournament; replaces any earlier one. Nothing in it clears the deck. */
export const DeckSetPayloadSchema = DeckSchema.extend({ playerId: UuidSchema });
export type DeckSetPayload = z.infer<typeof DeckSetPayloadSchema>;

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
export const PlayerUnregisteredSchema = eventSchema(
  'PlayerUnregistered',
  PlayerUnregisteredPayloadSchema,
);
export const TournamentDetailsChangedSchema = eventSchema(
  'TournamentDetailsChanged',
  TournamentDetailsChangedPayloadSchema,
);
export const RoundPairedSchema = eventSchema('RoundPaired', RoundPairedPayloadSchema);
export const PlayersSwappedSchema = eventSchema('PlayersSwapped', PlayersSwappedPayloadSchema);
export const ResultReportedSchema = eventSchema('ResultReported', ResultReportedPayloadSchema);
export const RoundClosedSchema = eventSchema('RoundClosed', RoundClosedPayloadSchema);
export const TopCutStartedSchema = eventSchema('TopCutStarted', TopCutStartedPayloadSchema);
export const TournamentFinishedSchema = eventSchema(
  'TournamentFinished',
  TournamentFinishedPayloadSchema,
);
export const DeckSetSchema = eventSchema('DeckSet', DeckSetPayloadSchema);
export const RolledBackSchema = eventSchema('RolledBack', RolledBackPayloadSchema);

export type TournamentCreated = z.infer<typeof TournamentCreatedSchema>;
export type PlayerRegistered = z.infer<typeof PlayerRegisteredSchema>;
export type PlayerDropped = z.infer<typeof PlayerDroppedSchema>;
export type PlayerUnregistered = z.infer<typeof PlayerUnregisteredSchema>;
export type TournamentDetailsChanged = z.infer<typeof TournamentDetailsChangedSchema>;
export type RoundPaired = z.infer<typeof RoundPairedSchema>;
export type PlayersSwapped = z.infer<typeof PlayersSwappedSchema>;
export type ResultReported = z.infer<typeof ResultReportedSchema>;
export type RoundClosed = z.infer<typeof RoundClosedSchema>;
export type TopCutStarted = z.infer<typeof TopCutStartedSchema>;
export type TournamentFinished = z.infer<typeof TournamentFinishedSchema>;
export type DeckSet = z.infer<typeof DeckSetSchema>;
export type RolledBack = z.infer<typeof RolledBackSchema>;

export const TournamentEventSchema = z.discriminatedUnion('type', [
  TournamentCreatedSchema,
  PlayerRegisteredSchema,
  PlayerDroppedSchema,
  PlayerUnregisteredSchema,
  TournamentDetailsChangedSchema,
  RoundPairedSchema,
  PlayersSwappedSchema,
  ResultReportedSchema,
  RoundClosedSchema,
  TopCutStartedSchema,
  TournamentFinishedSchema,
  DeckSetSchema,
  RolledBackSchema,
]);
export type TournamentEvent = z.infer<typeof TournamentEventSchema>;
export type TournamentEventType = TournamentEvent['type'];
export type EventPayload<T extends TournamentEventType> = Extract<
  TournamentEvent,
  { type: T }
>['payload'];
