import type { TournamentDocument } from '../schemas/document';
import type {
  EventPayload,
  Pairing,
  TournamentCreatedPayload,
  TournamentEvent,
  TournamentEventType,
} from '../schemas/events';
import type { MatchResult } from '../schemas/matchResult';

/** Deterministic UUID for tests: `uuid(1)` → `00000000-0000-4000-8000-000000000001`. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const TOURNAMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

export const PLAYERS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => uuid(100 + n));

export const CREATED_PAYLOAD: TournamentCreatedPayload = {
  name: 'Friday Night Magic',
  date: '2026-10-11',
  location: 'Local store',
  format: 'modern',
  swissRounds: 3,
};

export type PayloadOf<T extends TournamentEventType> = EventPayload<T>;

/** Builds one event with a deterministic id and timestamp derived from `seq`. */
export function event<T extends TournamentEventType>(
  seq: number,
  type: T,
  payload: PayloadOf<T>,
): TournamentEvent {
  return {
    id: uuid(seq),
    seq,
    at: new Date(Date.UTC(2026, 9, 11, 18, 0, seq)).toISOString(),
    type,
    payload,
  } as TournamentEvent;
}

/** Builds a gapless log: each call to `add` appends an event with the next seq. */
export function logBuilder(created: TournamentCreatedPayload = CREATED_PAYLOAD) {
  const events: TournamentEvent[] = [event(1, 'TournamentCreated', created)];
  return {
    events,
    add<T extends TournamentEventType>(type: T, payload: PayloadOf<T>) {
      events.push(event(events.length + 1, type, payload));
      return this;
    },
  };
}

/** Pairing for match `uuid(1000 + n)` at table `table`. `b = null` is a bye. */
export function pairing(n: number, table: number, a: string, b: string | null): Pairing {
  return { matchId: matchId(n), table, playerA: a, playerB: b };
}

export function matchId(n: number): string {
  return uuid(1000 + n);
}

/** A log with the first `count` players of `PLAYERS` registered as `Player 1`, `Player 2`… */
export function registeredLog(count: number, created: TournamentCreatedPayload = CREATED_PAYLOAD) {
  const log = logBuilder(created);
  for (const [i, playerId] of PLAYERS.slice(0, count).entries()) {
    log.add('PlayerRegistered', { playerId, playerName: `Player ${i + 1}` });
  }
  return log;
}

export type LogBuilder = ReturnType<typeof logBuilder>;

/** 2-1 win for player A. */
export const WIN_A: MatchResult = { winsA: 2, winsB: 1, draws: 0, kind: 'played' };

/** Pairs a round, reports `WIN_A` for every non-bye match, then closes it. */
export function addClosedRound(
  log: LogBuilder,
  round: number,
  stage: 'swiss' | 'topCut',
  pairings: Pairing[],
): LogBuilder {
  log.add('RoundPaired', { round, stage, pairings });
  for (const p of pairings) {
    if (p.playerB !== null) {
      log.add('ResultReported', { matchId: p.matchId, result: WIN_A });
    }
  }
  return log.add('RoundClosed', { round });
}

/**
 * A `running` document: the first `count` players of `PLAYERS` registered and swiss round 1
 * paired in order (matches 1, 2…, still open). An odd count gives the last player a bye.
 */
export function runningDoc(
  count = 4,
  created: TournamentCreatedPayload = CREATED_PAYLOAD,
): TournamentDocument {
  const ids = PLAYERS.slice(0, count);
  const pairings = Array.from({ length: Math.ceil(count / 2) }, (_, i) =>
    pairing(i + 1, i + 1, ids[2 * i], ids[2 * i + 1] ?? null),
  );
  const log = registeredLog(count, created).add('RoundPaired', {
    round: 1,
    stage: 'swiss',
    pairings,
  });
  return { schemaVersion: 1, id: TOURNAMENT_ID, events: log.events };
}
