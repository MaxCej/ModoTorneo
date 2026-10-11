import { describe, expect, it } from 'vitest';
import { CREATED_PAYLOAD, PLAYERS, TOURNAMENT_ID, event, logBuilder } from './fixtures/builders';
import { reduce } from './reduce';
import type { TournamentState } from './state';
import { validate } from './validate';

const [P1, P2] = PLAYERS;

function stateWith(
  build: (log: ReturnType<typeof logBuilder>) => void = () => {},
): TournamentState {
  const log = logBuilder();
  build(log);
  return reduce(log.events, TOURNAMENT_ID);
}

const registeredP1 = (log: ReturnType<typeof logBuilder>) =>
  log.add('PlayerRegistered', { playerId: P1, playerName: 'Alice' });

const droppedP1 = (log: ReturnType<typeof logBuilder>) =>
  registeredP1(log).add('PlayerDropped', { playerId: P1 });

describe('validate: log shape', () => {
  it('accepts TournamentCreated with seq 1 as the first event', () => {
    expect(validate(null, event(1, 'TournamentCreated', CREATED_PAYLOAD))).toBeNull();
  });

  it('rejects a first event that is not TournamentCreated', () => {
    const error = validate(
      null,
      event(1, 'PlayerRegistered', { playerId: P1, playerName: 'Alice' }),
    );
    expect(error).toMatchObject({ code: 'FIRST_EVENT_NOT_CREATED', seq: 1 });
  });

  it('rejects a first event whose seq is not 1', () => {
    expect(validate(null, event(2, 'TournamentCreated', CREATED_PAYLOAD))).toMatchObject({
      code: 'SEQ_GAP',
      seq: 2,
    });
  });

  it('rejects a second TournamentCreated', () => {
    expect(validate(stateWith(), event(2, 'TournamentCreated', CREATED_PAYLOAD))).toMatchObject({
      code: 'DUPLICATE_CREATED',
      seq: 2,
    });
  });

  it.each([1, 3, 10])('rejects seq %i after lastSeq 1', (seq) => {
    expect(validate(stateWith(), event(seq, 'PlayerDropped', { playerId: P1 }))).toMatchObject({
      code: 'SEQ_GAP',
      seq,
    });
  });
});

describe('validate: PlayerRegistered', () => {
  const register = (seq: number) =>
    event(seq, 'PlayerRegistered', { playerId: P1, playerName: 'Alice' });

  it.each(['setup', 'running'] as const)('accepts a new player while %s', (status) => {
    expect(validate({ ...stateWith(), status }, register(2))).toBeNull();
  });

  it.each(['topCut', 'finished'] as const)('rejects registration while %s', (status) => {
    expect(validate({ ...stateWith(), status }, register(2))).toMatchObject({
      code: 'WRONG_STATUS',
      seq: 2,
    });
  });

  it('rejects a player who is already registered', () => {
    expect(validate(stateWith(registeredP1), register(3))).toMatchObject({
      code: 'DUPLICATE_PLAYER',
      seq: 3,
    });
  });

  it('rejects re-registering a dropped player', () => {
    expect(validate(stateWith(droppedP1), register(4))).toMatchObject({ code: 'DUPLICATE_PLAYER' });
  });
});

describe('validate: PlayerDropped', () => {
  it.each(['setup', 'running'] as const)(
    'accepts dropping a registered player while %s',
    (status) => {
      const state = { ...stateWith(registeredP1), status };
      expect(validate(state, event(3, 'PlayerDropped', { playerId: P1 }))).toBeNull();
    },
  );

  it.each(['topCut', 'finished'] as const)('rejects a drop while %s', (status) => {
    const state = { ...stateWith(registeredP1), status };
    expect(validate(state, event(3, 'PlayerDropped', { playerId: P1 }))).toMatchObject({
      code: 'WRONG_STATUS',
    });
  });

  it('rejects an unknown player', () => {
    expect(
      validate(stateWith(registeredP1), event(3, 'PlayerDropped', { playerId: P2 })),
    ).toMatchObject({
      code: 'UNKNOWN_PLAYER',
      seq: 3,
    });
  });

  it('rejects a player who has already dropped', () => {
    expect(
      validate(stateWith(droppedP1), event(4, 'PlayerDropped', { playerId: P1 })),
    ).toMatchObject({
      code: 'PLAYER_DROPPED',
      seq: 4,
    });
  });
});
