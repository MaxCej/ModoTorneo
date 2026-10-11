import type {
  TournamentCreatedPayload,
  TournamentEvent,
  TournamentEventType,
} from '../schemas/events';

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
  topCut: 4,
};

type PayloadOf<T extends TournamentEventType> = Extract<TournamentEvent, { type: T }>['payload'];

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
