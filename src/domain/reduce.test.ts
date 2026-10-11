import { describe, expect, it } from 'vitest';
import { CorruptLogError, type DomainError } from './errors';
import {
  CREATED_PAYLOAD,
  PLAYERS,
  TOURNAMENT_ID,
  event,
  logBuilder,
  uuid,
} from './fixtures/builders';
import { apply, reduce } from './reduce';
import type { TournamentEvent } from './schemas/events';

const [P1, P2] = PLAYERS;

function corruptError(events: TournamentEvent[]): DomainError {
  try {
    reduce(events, TOURNAMENT_ID);
  } catch (error) {
    expect(error).toBeInstanceOf(CorruptLogError);
    return (error as CorruptLogError).error;
  }
  throw new Error('expected reduce to throw');
}

describe('reduce', () => {
  it('derives the initial state from TournamentCreated', () => {
    expect(reduce(logBuilder().events, TOURNAMENT_ID)).toMatchObject({
      id: TOURNAMENT_ID,
      ...CREATED_PAYLOAD,
      status: 'setup',
      lastSeq: 1,
    });
  });

  it('registers players with their name snapshot and optional deck', () => {
    const deckId = uuid(900);
    const { events } = logBuilder()
      .add('PlayerRegistered', { playerId: P1, playerName: 'Alice', deckId })
      .add('PlayerRegistered', { playerId: P2, playerName: 'Bob' });

    const state = reduce(events, TOURNAMENT_ID);

    expect(state.players).toEqual({
      [P1]: { playerId: P1, playerName: 'Alice', deckId, dropped: false, registeredAtRound: 0 },
      [P2]: { playerId: P2, playerName: 'Bob', dropped: false, registeredAtRound: 0 },
    });
    expect(state.players[P2]).not.toHaveProperty('deckId');
    expect(state.lastSeq).toBe(3);
  });

  it('marks a dropped player without removing them', () => {
    const { events } = logBuilder()
      .add('PlayerRegistered', { playerId: P1, playerName: 'Alice' })
      .add('PlayerDropped', { playerId: P1 });

    expect(reduce(events, TOURNAMENT_ID).players[P1]).toMatchObject({ dropped: true });
  });

  it('throws FIRST_EVENT_NOT_CREATED for an empty log', () => {
    expect(corruptError([])).toMatchObject({ code: 'FIRST_EVENT_NOT_CREATED' });
  });

  it('throws FIRST_EVENT_NOT_CREATED when the log does not start with TournamentCreated', () => {
    const events = [event(1, 'PlayerRegistered', { playerId: P1, playerName: 'Alice' })];
    expect(corruptError(events)).toMatchObject({ code: 'FIRST_EVENT_NOT_CREATED', seq: 1 });
  });

  it('throws DUPLICATE_CREATED for a second TournamentCreated', () => {
    const events = [...logBuilder().events, event(2, 'TournamentCreated', CREATED_PAYLOAD)];
    expect(corruptError(events)).toMatchObject({ code: 'DUPLICATE_CREATED', seq: 2 });
  });

  it('throws SEQ_GAP for a log with a seq gap', () => {
    const events = [
      ...logBuilder().events,
      event(3, 'PlayerRegistered', { playerId: P1, playerName: 'Alice' }),
    ];
    expect(corruptError(events)).toMatchObject({ code: 'SEQ_GAP', seq: 3 });
  });

  it('throws on an event that breaks a rule', () => {
    const { events } = logBuilder().add('PlayerDropped', { playerId: P1 });
    expect(corruptError(events)).toMatchObject({ code: 'UNKNOWN_PLAYER', seq: 2 });
  });
});

describe('apply', () => {
  it('never mutates the input state', () => {
    const { events } = logBuilder().add('PlayerRegistered', { playerId: P1, playerName: 'Alice' });
    const state = reduce(events, TOURNAMENT_ID);
    const snapshot = structuredClone(state);

    apply(state, event(3, 'PlayerRegistered', { playerId: P2, playerName: 'Bob' }), TOURNAMENT_ID);
    apply(state, event(3, 'PlayerDropped', { playerId: P1 }), TOURNAMENT_ID);

    expect(state).toEqual(snapshot);
  });
});
