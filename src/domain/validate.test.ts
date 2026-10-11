import { describe, expect, it } from 'vitest';
import {
  CREATED_PAYLOAD,
  PLAYERS,
  TOURNAMENT_ID,
  event,
  logBuilder,
  matchId,
  pairing,
  registeredLog,
  type PayloadOf,
} from './fixtures/builders';
import { reduce } from './reduce';
import type { Pairing, TournamentEventType } from './schemas/events';
import type { MatchResult } from './schemas/matchResult';
import type { TournamentState } from './state';
import { validate } from './validate';

const [P1, P2, P3, P4, P5] = PLAYERS;

const WIN_A: MatchResult = { winsA: 2, winsB: 1, draws: 0, kind: 'played' };

type Log = ReturnType<typeof logBuilder>;

/** Validates an event that carries the next seq after `state.lastSeq`. */
function validateNext<T extends TournamentEventType>(
  state: TournamentState,
  type: T,
  payload: PayloadOf<T>,
) {
  return validate(state, event(state.lastSeq + 1, type, payload));
}

const reduceLog = (log: Log) => reduce(log.events, TOURNAMENT_ID);

const swiss = (round: number, pairings: Pairing[]) => ({
  round,
  stage: 'swiss' as const,
  pairings,
});

/** 4 players, round 1 paired (matches 1 and 2), round still open. */
const round1Open = () =>
  registeredLog(4).add('RoundPaired', swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)]));

/** `round1Open` with both results reported and the round closed. */
const round1Closed = () =>
  round1Open()
    .add('ResultReported', { matchId: matchId(1), result: WIN_A })
    .add('ResultReported', { matchId: matchId(2), result: WIN_A })
    .add('RoundClosed', { round: 1 });

/** 3 players, round 1 paired with P3 on a bye (match 2). */
const round1WithBye = () =>
  registeredLog(3).add('RoundPaired', swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, null)]));

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

describe('validate: RoundPaired (swiss)', () => {
  const fourPlayers = () => reduceLog(registeredLog(4));

  it('accepts every active player paired exactly once', () => {
    const pairings = [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)];
    expect(validateNext(fourPlayers(), 'RoundPaired', swiss(1, pairings))).toBeNull();
  });

  it('accepts one bye when the active count is odd', () => {
    const pairings = [pairing(1, 1, P1, P2), pairing(2, 2, P3, null)];
    expect(validateNext(reduceLog(registeredLog(3)), 'RoundPaired', swiss(1, pairings))).toBeNull();
  });

  it('does not require dropped players to be paired', () => {
    const state = reduceLog(registeredLog(5).add('PlayerDropped', { playerId: P5 }));
    const pairings = [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)];
    expect(validateNext(state, 'RoundPaired', swiss(1, pairings))).toBeNull();
  });

  it.each(['topCut', 'finished'] as const)('rejects swiss pairings while %s', (status) => {
    const pairings = [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)];
    expect(
      validateNext({ ...fourPlayers(), status }, 'RoundPaired', swiss(1, pairings)),
    ).toMatchObject({
      code: 'WRONG_STATUS',
    });
  });

  it('rejects pairing while the previous round is open', () => {
    const pairings = [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)];
    expect(validateNext(reduceLog(round1Open()), 'RoundPaired', swiss(2, pairings))).toMatchObject({
      code: 'ROUND_STILL_OPEN',
    });
  });

  it('rejects round 2 as the first round', () => {
    const pairings = [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)];
    expect(validateNext(fourPlayers(), 'RoundPaired', swiss(2, pairings))).toMatchObject({
      code: 'ROUND_OUT_OF_ORDER',
    });
  });

  it('rejects a round beyond swissRounds', () => {
    const log = registeredLog(4, { ...CREATED_PAYLOAD, swissRounds: 1 })
      .add('RoundPaired', swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)]))
      .add('ResultReported', { matchId: matchId(1), result: WIN_A })
      .add('ResultReported', { matchId: matchId(2), result: WIN_A })
      .add('RoundClosed', { round: 1 });
    const pairings = [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)];
    expect(validateNext(reduceLog(log), 'RoundPaired', swiss(2, pairings))).toMatchObject({
      code: 'TOO_MANY_ROUNDS',
    });
  });

  it.each([
    ['omit an active player', [pairing(1, 1, P1, P2), pairing(2, 2, P3, null)]],
    [
      'pair a player twice',
      [pairing(1, 1, P1, P2), pairing(2, 2, P3, P1), pairing(3, 3, P4, null)],
    ],
    ['pair a player against themselves', [pairing(1, 1, P1, P1), pairing(2, 2, P3, P4)]],
    ['repeat a table', [pairing(1, 1, P1, P2), pairing(2, 1, P3, P4)]],
    ['repeat a match id', [pairing(1, 1, P1, P2), pairing(1, 2, P3, P4)]],
    [
      'give byes with an even count',
      [pairing(1, 1, P1, P2), pairing(2, 2, P3, null), pairing(3, 3, P4, null)],
    ],
  ])('rejects pairings that %s', (_, pairings) => {
    expect(validateNext(fourPlayers(), 'RoundPaired', swiss(1, pairings))).toMatchObject({
      code: 'INVALID_PAIRINGS',
    });
  });

  it('rejects more than one bye with an odd count', () => {
    const pairings = [
      pairing(1, 1, P1, null),
      pairing(2, 2, P2, null),
      pairing(3, 3, P3, null),
      pairing(4, 4, P4, P5),
    ];
    expect(
      validateNext(reduceLog(registeredLog(5)), 'RoundPaired', swiss(1, pairings)),
    ).toMatchObject({ code: 'INVALID_PAIRINGS' });
  });

  it('rejects a match id used in an earlier round', () => {
    const pairings = [pairing(1, 1, P1, P3), pairing(3, 2, P2, P4)];
    expect(
      validateNext(reduceLog(round1Closed()), 'RoundPaired', swiss(2, pairings)),
    ).toMatchObject({ code: 'INVALID_PAIRINGS' });
  });

  it('rejects a round with fewer than 2 active players', () => {
    const state = reduceLog(registeredLog(2).add('PlayerDropped', { playerId: P2 }));
    expect(validateNext(state, 'RoundPaired', swiss(1, [pairing(1, 1, P1, null)]))).toMatchObject({
      code: 'INVALID_PAIRINGS',
    });
  });

  it('rejects an unknown player', () => {
    const pairings = [pairing(1, 1, P1, P2), pairing(2, 2, P3, P5)];
    expect(
      validateNext(reduceLog(registeredLog(3)), 'RoundPaired', swiss(1, pairings)),
    ).toMatchObject({ code: 'UNKNOWN_PLAYER' });
  });

  it('rejects a dropped player', () => {
    const state = reduceLog(registeredLog(5).add('PlayerDropped', { playerId: P5 }));
    const pairings = [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4), pairing(3, 3, P5, null)];
    expect(validateNext(state, 'RoundPaired', swiss(1, pairings))).toMatchObject({
      code: 'PLAYER_DROPPED',
    });
  });
});

describe('validate: ResultReported', () => {
  const report = (n: number, result = WIN_A) => ({ matchId: matchId(n), result });

  it('accepts a result for a match in the open round', () => {
    expect(validateNext(reduceLog(round1Open()), 'ResultReported', report(1))).toBeNull();
  });

  it('accepts a second report for the same match', () => {
    const state = reduceLog(round1Open().add('ResultReported', report(1)));
    const reversed: MatchResult = { winsA: 0, winsB: 2, draws: 0, kind: 'played' };
    expect(validateNext(state, 'ResultReported', report(1, reversed))).toBeNull();
  });

  it('rejects an unknown match', () => {
    expect(validateNext(reduceLog(round1Open()), 'ResultReported', report(99))).toMatchObject({
      code: 'UNKNOWN_MATCH',
    });
  });

  it('rejects a match in a closed round', () => {
    expect(validateNext(reduceLog(round1Closed()), 'ResultReported', report(1))).toMatchObject({
      code: 'ROUND_CLOSED',
    });
  });

  it('rejects a result for a bye', () => {
    expect(validateNext(reduceLog(round1WithBye()), 'ResultReported', report(2))).toMatchObject({
      code: 'BYE_RESULT',
    });
  });
});

describe('validate: RoundClosed', () => {
  it('accepts closing the open round once every match has a result', () => {
    const log = round1Open()
      .add('ResultReported', { matchId: matchId(1), result: WIN_A })
      .add('ResultReported', { matchId: matchId(2), result: WIN_A });
    expect(validateNext(reduceLog(log), 'RoundClosed', { round: 1 })).toBeNull();
  });

  it('does not require a result for a bye', () => {
    const log = round1WithBye().add('ResultReported', { matchId: matchId(1), result: WIN_A });
    expect(validateNext(reduceLog(log), 'RoundClosed', { round: 1 })).toBeNull();
  });

  it('rejects closing a round with missing results', () => {
    const log = round1Open().add('ResultReported', { matchId: matchId(1), result: WIN_A });
    expect(validateNext(reduceLog(log), 'RoundClosed', { round: 1 })).toMatchObject({
      code: 'MISSING_RESULTS',
    });
  });

  it('rejects a round number other than the open round', () => {
    expect(validateNext(reduceLog(round1Open()), 'RoundClosed', { round: 2 })).toMatchObject({
      code: 'ROUND_OUT_OF_ORDER',
    });
  });

  it('rejects closing a round that is already closed', () => {
    expect(validateNext(reduceLog(round1Closed()), 'RoundClosed', { round: 1 })).toMatchObject({
      code: 'ROUND_CLOSED',
    });
  });

  it('rejects closing when no round has been paired', () => {
    expect(validateNext(reduceLog(registeredLog(4)), 'RoundClosed', { round: 1 })).toMatchObject({
      code: 'ROUND_CLOSED',
    });
  });
});
