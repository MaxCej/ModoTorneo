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
  uuid,
  WIN_A,
  addClosedRound,
  type PayloadOf,
} from './fixtures/builders';
import { reduce } from './reduce';
import type { Pairing, TournamentCreatedPayload, TournamentEventType } from './schemas/events';
import type { MatchResult } from './schemas/matchResult';
import type { TournamentState } from './state';
import { validate } from './validate';

const [P1, P2, P3, P4, P5, P6, P7, P8] = PLAYERS;

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

const TWO_ROUNDS: TournamentCreatedPayload = { ...CREATED_PAYLOAD, swissRounds: 2 };

/** 4 players, swiss round 1 of 2 played and closed (matches 1 and 2), status `running`. */
const swissRound1Done = () =>
  addClosedRound(registeredLog(4, TWO_ROUNDS), 1, 'swiss', [
    pairing(1, 1, P1, P2),
    pairing(2, 2, P3, P4),
  ]);

/** 4 players, both swiss rounds played and closed (matches 1–4), status `running`. */
const swissDone = () =>
  addClosedRound(
    addClosedRound(registeredLog(4, TWO_ROUNDS), 1, 'swiss', [
      pairing(1, 1, P1, P2),
      pairing(2, 2, P3, P4),
    ]),
    2,
    'swiss',
    [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)],
  );

const topCut = (round: number, pairings: Pairing[]) => ({
  round,
  stage: 'topCut' as const,
  pairings,
});

const SEMIS = [pairing(5, 1, P1, P4), pairing(6, 2, P2, P3)];

/** `swissDone` plus TopCutStarted and the open semifinal round 3 (matches 5 and 6). */
const semisOpen = () =>
  swissDone().add('TopCutStarted', { size: 4 }).add('RoundPaired', topCut(3, SEMIS));

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

describe('validate: PlayerUnregistered', () => {
  it('accepts a registered player in setup', () => {
    expect(
      validate(stateWith(registeredP1), event(3, 'PlayerUnregistered', { playerId: P1 })),
    ).toBeNull();
  });

  it('accepts a dropped player in setup', () => {
    expect(
      validate(stateWith(droppedP1), event(4, 'PlayerUnregistered', { playerId: P1 })),
    ).toBeNull();
  });

  it.each(['running', 'topCut', 'finished'] as const)('rejects it while %s', (status) => {
    const state = { ...stateWith(registeredP1), status };
    expect(validate(state, event(3, 'PlayerUnregistered', { playerId: P1 }))).toMatchObject({
      code: 'WRONG_STATUS',
      seq: 3,
    });
  });

  it('returns WRONG_STATUS once round 1 is paired', () => {
    expect(
      validateNext(reduceLog(round1Open()), 'PlayerUnregistered', { playerId: P1 }),
    ).toMatchObject({ code: 'WRONG_STATUS' });
  });

  it('rejects an unknown player', () => {
    expect(
      validate(stateWith(registeredP1), event(3, 'PlayerUnregistered', { playerId: P2 })),
    ).toMatchObject({ code: 'UNKNOWN_PLAYER', seq: 3 });
  });

  it('rejects a player who was already unregistered', () => {
    const state = stateWith((log) => registeredP1(log).add('PlayerUnregistered', { playerId: P1 }));
    expect(validate(state, event(4, 'PlayerUnregistered', { playerId: P1 }))).toMatchObject({
      code: 'UNKNOWN_PLAYER',
    });
  });
});

describe('validate: TournamentDetailsChanged', () => {
  type Details = PayloadOf<'TournamentDetailsChanged'>;

  /** One state per status. `running` has 1 of 2 swiss rounds paired and closed. */
  const states = {
    setup: () => reduceLog(registeredLog(4, TWO_ROUNDS)),
    running: () => reduceLog(swissRound1Done()),
    topCut: () => reduceLog(swissDone().add('TopCutStarted', { size: 4 })),
    finished: () => reduceLog(swissDone().add('TournamentFinished', {})),
  };

  const ALLOWED: Record<keyof typeof states, Details[]> = {
    setup: [
      { name: 'Renamed' },
      { date: '2026-12-01' },
      { location: 'Elsewhere' },
      { format: 'legacy' },
      { swissRounds: 5 },
      { swissRounds: null },
    ],
    running: [
      { name: 'Renamed' },
      { date: '2026-12-01' },
      { location: 'Elsewhere' },
      { swissRounds: 3 },
    ],
    topCut: [{ name: 'Renamed' }, { date: '2026-12-01' }, { location: 'Elsewhere' }],
    finished: [{ name: 'Renamed' }, { date: '2026-12-01' }, { location: 'Elsewhere' }],
  };

  const BLOCKED: Record<keyof typeof states, Details[]> = {
    setup: [],
    running: [{ format: 'legacy' }, { name: 'Renamed', format: 'legacy' }],
    topCut: [{ format: 'legacy' }, { swissRounds: 3 }],
    finished: [{ format: 'legacy' }, { swissRounds: 3 }],
  };

  describe.each(Object.keys(states) as (keyof typeof states)[])('while %s', (status) => {
    it('starts from the expected status', () => {
      expect(states[status]().status).toBe(status);
    });

    it.each(ALLOWED[status])('accepts %j', (payload) => {
      expect(validateNext(states[status](), 'TournamentDetailsChanged', payload)).toBeNull();
    });

    if (BLOCKED[status].length > 0) {
      it.each(BLOCKED[status])('rejects %j with WRONG_STATUS', (payload) => {
        expect(validateNext(states[status](), 'TournamentDetailsChanged', payload)).toMatchObject({
          code: 'WRONG_STATUS',
        });
      });
    }
  });

  it('accepts swissRounds equal to the swiss rounds already paired', () => {
    expect(
      validateNext(reduceLog(swissDone()), 'TournamentDetailsChanged', { swissRounds: 2 }),
    ).toBeNull();
  });

  it('rejects swissRounds below the swiss rounds already paired', () => {
    expect(
      validateNext(reduceLog(swissDone()), 'TournamentDetailsChanged', { swissRounds: 1 }),
    ).toMatchObject({ code: 'INVALID_DETAILS' });
  });

  it('rejects swissRounds null (auto) while running', () => {
    expect(
      validateNext(reduceLog(swissRound1Done()), 'TournamentDetailsChanged', { swissRounds: null }),
    ).toMatchObject({ code: 'INVALID_DETAILS' });
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

describe('validate: PlayersSwapped', () => {
  const swap = (round: number, playerA: string, playerB: string) => ({ round, playerA, playerB });

  /** 5 players, round 1 open: P1-P2 (match 1), P3-P4 (match 2), P5 on a bye (match 3). */
  const round1OpenWithBye = () =>
    registeredLog(5).add(
      'RoundPaired',
      swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4), pairing(3, 3, P5, null)]),
    );

  it('accepts two players from different unreported matches', () => {
    expect(validateNext(reduceLog(round1Open()), 'PlayersSwapped', swap(1, P1, P3))).toBeNull();
    expect(validateNext(reduceLog(round1Open()), 'PlayersSwapped', swap(1, P4, P2))).toBeNull();
  });

  it.each([
    ['into the bye', P1],
    ['as player B into the bye', P2],
  ])('accepts a swap %s', (_, seated) => {
    const state = reduceLog(round1OpenWithBye());
    expect(validateNext(state, 'PlayersSwapped', swap(1, P5, seated))).toBeNull();
    expect(validateNext(state, 'PlayersSwapped', swap(1, seated, P5))).toBeNull();
  });

  it('accepts a swap with the bye after the other matches are reported', () => {
    const state = reduceLog(
      round1OpenWithBye().add('ResultReported', { matchId: matchId(2), result: WIN_A }),
    );
    expect(validateNext(state, 'PlayersSwapped', swap(1, P1, P5))).toBeNull();
  });

  it.each([
    ['in setup', () => registeredLog(4)],
    ['once the round is closed', round1Closed],
  ])('returns ROUND_CLOSED %s', (_, build) => {
    expect(validateNext(reduceLog(build()), 'PlayersSwapped', swap(1, P1, P3))).toMatchObject({
      code: 'ROUND_CLOSED',
    });
  });

  it('returns ROUND_OUT_OF_ORDER for a round that is not the open one', () => {
    expect(validateNext(reduceLog(round1Open()), 'PlayersSwapped', swap(2, P1, P3))).toMatchObject({
      code: 'ROUND_OUT_OF_ORDER',
    });
  });

  it('returns WRONG_STATUS in a top cut round', () => {
    expect(validateNext(reduceLog(semisOpen()), 'PlayersSwapped', swap(3, P1, P2))).toMatchObject({
      code: 'WRONG_STATUS',
    });
  });

  it('returns UNKNOWN_PLAYER for a player who is not paired in the round', () => {
    const late = uuid(150);
    const state = reduceLog(
      round1Open().add('PlayerRegistered', { playerId: late, playerName: 'L' }),
    );
    expect(validateNext(state, 'PlayersSwapped', swap(1, P1, late))).toMatchObject({
      code: 'UNKNOWN_PLAYER',
    });
    expect(validateNext(state, 'PlayersSwapped', swap(1, uuid(999), P1))).toMatchObject({
      code: 'UNKNOWN_PLAYER',
    });
  });

  it('returns PLAYER_DROPPED for a dropped player', () => {
    const state = reduceLog(round1Open().add('PlayerDropped', { playerId: P3 }));
    expect(validateNext(state, 'PlayersSwapped', swap(1, P1, P3))).toMatchObject({
      code: 'PLAYER_DROPPED',
    });
  });

  it.each([
    ['the same player twice', P1, P1],
    ['two opponents in the same match', P1, P2],
  ])('returns INVALID_SWAP for %s', (_, a, b) => {
    expect(validateNext(reduceLog(round1Open()), 'PlayersSwapped', swap(1, a, b))).toMatchObject({
      code: 'INVALID_SWAP',
    });
  });

  it.each([
    ['the first', P1, P3],
    ['the second', P3, P1],
  ])('returns INVALID_SWAP when %s match has a result', (_, a, b) => {
    const state = reduceLog(
      round1Open().add('ResultReported', { matchId: matchId(1), result: WIN_A }),
    );
    expect(validateNext(state, 'PlayersSwapped', swap(1, a, b))).toMatchObject({
      code: 'INVALID_SWAP',
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

describe('validate: TopCutStarted', () => {
  it.each([4, 8, 16, 32] as const)('accepts top %i once swiss is closed', (size) => {
    // Only the active player count matters here; build it directly.
    const ids = Array.from({ length: size }, (_, i) => uuid(200 + i));
    const players = ids.map((id) => [
      id,
      {
        playerId: id,
        playerName: id,
        guest: false,
        dropped: false,
        registeredAtRound: 0,
        deck: null,
      },
    ]);
    const crowded = { ...reduceLog(swissDone()), players: Object.fromEntries(players) };
    expect(validateNext(crowded, 'TopCutStarted', { size })).toBeNull();
  });

  it('accepts stopping swiss early, before swissRounds is reached', () => {
    expect(validateNext(reduceLog(swissRound1Done()), 'TopCutStarted', { size: 4 })).toBeNull();
  });

  it('rejects starting the top cut during setup', () => {
    expect(
      validateNext(reduceLog(registeredLog(4, TWO_ROUNDS)), 'TopCutStarted', { size: 4 }),
    ).toMatchObject({ code: 'WRONG_STATUS' });
  });

  it('rejects starting the top cut twice', () => {
    const state = reduceLog(swissDone().add('TopCutStarted', { size: 4 }));
    expect(validateNext(state, 'TopCutStarted', { size: 4 })).toMatchObject({
      code: 'WRONG_STATUS',
    });
  });

  it('rejects starting the top cut after the tournament finished', () => {
    const state = reduceLog(swissDone().add('TournamentFinished', {}));
    expect(validateNext(state, 'TopCutStarted', { size: 4 })).toMatchObject({
      code: 'WRONG_STATUS',
    });
  });

  it('rejects a size larger than the active players', () => {
    expect(validateNext(reduceLog(swissDone()), 'TopCutStarted', { size: 8 })).toMatchObject({
      code: 'WRONG_STATUS',
    });
  });

  it('does not count dropped players toward the size', () => {
    const state = reduceLog(swissDone());
    const p4 = state.players[P4];
    const withDrop = { ...state, players: { ...state.players, [P4]: { ...p4, dropped: true } } };
    expect(validateNext(withDrop, 'TopCutStarted', { size: 4 })).toMatchObject({
      code: 'WRONG_STATUS',
    });
  });

  it('rejects while a swiss round is open', () => {
    const log = swissRound1Done().add(
      'RoundPaired',
      swiss(2, [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)]),
    );
    expect(validateNext(reduceLog(log), 'TopCutStarted', { size: 4 })).toMatchObject({
      code: 'ROUND_STILL_OPEN',
    });
  });

  it('rejects when no swiss round has been played', () => {
    // A real log cannot be running without a round; build the state directly.
    const state = { ...reduceLog(registeredLog(4, TWO_ROUNDS)), status: 'running' as const };
    expect(validateNext(state, 'TopCutStarted', { size: 4 })).toMatchObject({
      code: 'ROUND_OUT_OF_ORDER',
    });
  });
});

describe('validate: RoundPaired (topCut)', () => {
  const started = () => reduceLog(swissDone().add('TopCutStarted', { size: 4 }));

  it('accepts the first top cut round', () => {
    expect(validateNext(started(), 'RoundPaired', topCut(3, SEMIS))).toBeNull();
  });

  it.each([
    ['too few matches', [pairing(5, 1, P1, P4)]],
    ['a table outside 1..size / 2', [pairing(5, 1, P1, P4), pairing(6, 3, P2, P3)]],
  ])('rejects a first top cut round with %s', (_, pairings) => {
    expect(validateNext(started(), 'RoundPaired', topCut(3, pairings))).toMatchObject({
      code: 'INVALID_PAIRINGS',
    });
  });

  it('does not check the seeding against the standings', () => {
    const reversed = [pairing(5, 1, P4, P1), pairing(6, 2, P3, P2)];
    expect(validateNext(started(), 'RoundPaired', topCut(3, reversed))).toBeNull();
  });

  describe('after the semifinals', () => {
    // SEMIS: P1 beats P4 at table 1, P2 beats P3 at table 2 (WIN_A).
    const semisDone = () =>
      reduceLog(addClosedRound(swissDone().add('TopCutStarted', { size: 4 }), 3, 'topCut', SEMIS));

    it.each([
      ['P1 v P2', [pairing(7, 1, P1, P2)]],
      ['P2 v P1', [pairing(7, 1, P2, P1)]],
    ])('accepts the final between the winners (%s)', (_, pairings) => {
      expect(validateNext(semisDone(), 'RoundPaired', topCut(4, pairings))).toBeNull();
    });

    it.each([
      ['a loser', [pairing(7, 1, P1, P3)]],
      ['two matches', [pairing(7, 1, P1, P2), pairing(8, 2, P3, P4)]],
      ['table 2', [pairing(7, 2, P1, P2)]],
    ])('rejects a final with %s', (_, pairings) => {
      expect(validateNext(semisDone(), 'RoundPaired', topCut(4, pairings))).toMatchObject({
        code: 'INVALID_PAIRINGS',
      });
    });

    it('rejects a round after the final', () => {
      const log = addClosedRound(
        addClosedRound(swissDone().add('TopCutStarted', { size: 4 }), 3, 'topCut', SEMIS),
        4,
        'topCut',
        [pairing(7, 1, P1, P2)],
      );
      expect(
        validateNext(reduceLog(log), 'RoundPaired', topCut(5, [pairing(8, 1, P1, P2)])),
      ).toMatchObject({ code: 'INVALID_PAIRINGS' });
    });
  });

  describe('in a Top 8', () => {
    const top8Started = () =>
      addClosedRound(registeredLog(8, TWO_ROUNDS), 1, 'swiss', [
        pairing(1, 1, P1, P2),
        pairing(2, 2, P3, P4),
        pairing(3, 3, P5, P6),
        pairing(4, 4, P7, P8),
      ]).add('TopCutStarted', { size: 8 });
    // Quarterfinals: winners P1 (t1), P5 (t2), P2 (t3), P3 (t4).
    const quartersDone = () =>
      reduceLog(
        addClosedRound(top8Started(), 2, 'topCut', [
          pairing(5, 1, P1, P8),
          pairing(6, 2, P5, P4),
          pairing(7, 3, P2, P7),
          pairing(8, 4, P3, P6),
        ]),
      );

    it('accepts semifinals pairing the winners of tables 1–2 and 3–4', () => {
      const semis = [pairing(9, 1, P1, P5), pairing(10, 2, P2, P3)];
      expect(validateNext(quartersDone(), 'RoundPaired', topCut(3, semis))).toBeNull();
    });

    it('rejects semifinals pairing winners from the wrong tables', () => {
      const semis = [pairing(9, 1, P1, P2), pairing(10, 2, P5, P3)];
      expect(validateNext(quartersDone(), 'RoundPaired', topCut(3, semis))).toMatchObject({
        code: 'INVALID_PAIRINGS',
      });
    });
  });

  it('rejects top cut pairings before TopCutStarted', () => {
    expect(validateNext(reduceLog(swissDone()), 'RoundPaired', topCut(3, SEMIS))).toMatchObject({
      code: 'WRONG_STATUS',
    });
  });

  it('rejects swiss pairings during the top cut', () => {
    expect(validateNext(started(), 'RoundPaired', swiss(3, SEMIS))).toMatchObject({
      code: 'WRONG_STATUS',
    });
  });

  it('rejects pairing while the previous top cut round is open', () => {
    expect(
      validateNext(reduceLog(semisOpen()), 'RoundPaired', topCut(4, [pairing(7, 1, P1, P2)])),
    ).toMatchObject({ code: 'ROUND_STILL_OPEN' });
  });

  it('rejects a round number that skips ahead', () => {
    expect(validateNext(started(), 'RoundPaired', topCut(4, SEMIS))).toMatchObject({
      code: 'ROUND_OUT_OF_ORDER',
    });
  });

  it.each([
    ['contain a bye', [pairing(5, 1, P1, P4), pairing(6, 2, P2, null)]],
    ['pair a player twice', [pairing(5, 1, P1, P4), pairing(6, 2, P1, P3)]],
    ['repeat a table', [pairing(5, 1, P1, P4), pairing(6, 1, P2, P3)]],
    ['reuse a swiss match id', [pairing(1, 1, P1, P4), pairing(6, 2, P2, P3)]],
  ])('rejects pairings that %s', (_, pairings) => {
    expect(validateNext(started(), 'RoundPaired', topCut(3, pairings))).toMatchObject({
      code: 'INVALID_PAIRINGS',
    });
  });

  it('rejects an unknown player', () => {
    expect(
      validateNext(started(), 'RoundPaired', topCut(3, [pairing(5, 1, P1, P5)])),
    ).toMatchObject({ code: 'UNKNOWN_PLAYER' });
  });

  it('rejects a dropped player', () => {
    const log = addClosedRound(registeredLog(5, TWO_ROUNDS), 1, 'swiss', [
      pairing(1, 1, P1, P2),
      pairing(2, 2, P3, P4),
      pairing(3, 3, P5, null),
    ])
      .add('PlayerDropped', { playerId: P5 })
      .add('TopCutStarted', { size: 4 });
    const pairings = [pairing(5, 1, P1, P5), pairing(6, 2, P2, P3)];
    expect(validateNext(reduceLog(log), 'RoundPaired', topCut(2, pairings))).toMatchObject({
      code: 'PLAYER_DROPPED',
    });
  });
});

describe('validate: ResultReported (topCut)', () => {
  it('accepts a win for either player', () => {
    const state = reduceLog(semisOpen());
    const winB: MatchResult = { winsA: 1, winsB: 2, draws: 0, kind: 'played' };
    expect(
      validateNext(state, 'ResultReported', { matchId: matchId(5), result: WIN_A }),
    ).toBeNull();
    expect(validateNext(state, 'ResultReported', { matchId: matchId(5), result: winB })).toBeNull();
  });

  it.each([
    ['a played draw', { winsA: 1, winsB: 1, draws: 1, kind: 'played' }],
    ['an intentional draw', { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' }],
    ['an unplayed match', { winsA: 0, winsB: 0, draws: 0, kind: 'unplayed' }],
  ] as const)('rejects %s', (_, result) => {
    expect(
      validateNext(reduceLog(semisOpen()), 'ResultReported', { matchId: matchId(5), result }),
    ).toMatchObject({ code: 'TOP_CUT_DRAW' });
  });

  it('rejects a 3-0 in a best of three top cut', () => {
    const result: MatchResult = { winsA: 3, winsB: 0, draws: 0, kind: 'played' };
    expect(
      validateNext(reduceLog(semisOpen()), 'ResultReported', { matchId: matchId(5), result }),
    ).toMatchObject({ code: 'RESULT_EXCEEDS_BEST_OF' });
  });

  it('accepts a 3-2 and rejects a 3-2-1 in a best of five top cut', () => {
    const state = reduceLog(
      swissDone().add('TopCutStarted', { size: 4, bestOf: 5 }).add('RoundPaired', topCut(3, SEMIS)),
    );
    const report = (result: MatchResult) =>
      validateNext(state, 'ResultReported', { matchId: matchId(5), result });

    expect(report({ winsA: 3, winsB: 2, draws: 0, kind: 'played' })).toBeNull();
    expect(report({ winsA: 3, winsB: 2, draws: 1, kind: 'played' })).toMatchObject({
      code: 'RESULT_EXCEEDS_BEST_OF',
    });
  });

  it('still accepts a draw in a swiss round', () => {
    const draw: MatchResult = { winsA: 1, winsB: 1, draws: 0, kind: 'played' };
    expect(
      validateNext(reduceLog(round1Open()), 'ResultReported', {
        matchId: matchId(1),
        result: draw,
      }),
    ).toBeNull();
  });
});

describe('validate: TournamentFinished', () => {
  it('accepts finishing after the top cut rounds are closed', () => {
    const log = addClosedRound(swissDone().add('TopCutStarted', { size: 4 }), 3, 'topCut', SEMIS);
    expect(validateNext(reduceLog(log), 'TournamentFinished', {})).toBeNull();
  });

  it('accepts finishing without a top cut once swiss is closed', () => {
    expect(validateNext(reduceLog(swissDone()), 'TournamentFinished', {})).toBeNull();
  });

  it('accepts finishing before every swiss round is played', () => {
    expect(validateNext(reduceLog(swissRound1Done()), 'TournamentFinished', {})).toBeNull();
  });

  it('rejects finishing during setup', () => {
    expect(
      validateNext(reduceLog(registeredLog(4, TWO_ROUNDS)), 'TournamentFinished', {}),
    ).toMatchObject({ code: 'WRONG_STATUS' });
  });

  it('rejects finishing twice', () => {
    const state = reduceLog(swissDone().add('TournamentFinished', {}));
    expect(validateNext(state, 'TournamentFinished', {})).toMatchObject({ code: 'WRONG_STATUS' });
  });

  it('rejects finishing while a round is open', () => {
    expect(validateNext(reduceLog(semisOpen()), 'TournamentFinished', {})).toMatchObject({
      code: 'ROUND_STILL_OPEN',
    });
  });
});

describe('validate: RolledBack', () => {
  /** seq 1 created, 2–5 register P1–P4, 6 drops P4, 7 rolls back to 5 (voids 6), 8 drops P3. */
  const withRollback = () =>
    reduceLog(
      registeredLog(4)
        .add('PlayerDropped', { playerId: P4 })
        .add('RolledBack', { toSeq: 5 })
        .add('PlayerDropped', { playerId: P3 }),
    );

  it.each([1, 3, 5])('accepts effective seq %i as a target', (toSeq) => {
    expect(validateNext(withRollback(), 'RolledBack', { toSeq })).toBeNull();
  });

  it.each(['setup', 'running', 'topCut', 'finished'] as const)(
    'accepts a rollback while %s',
    (status) => {
      expect(validateNext({ ...withRollback(), status }, 'RolledBack', { toSeq: 2 })).toBeNull();
    },
  );

  it.each([
    ['a voided seq', 6],
    ['the seq of a RolledBack event', 7],
    ['the last seq (nothing to undo)', 8],
    ['a seq after the log', 9],
    ['seq 0', 0],
  ])('rejects %s', (_, toSeq) => {
    expect(validateNext(withRollback(), 'RolledBack', { toSeq })).toMatchObject({
      code: 'INVALID_ROLLBACK_TARGET',
      seq: 9,
    });
  });
});

describe('validate: DeckSet', () => {
  const deck = (playerId: string, main = [{ quantity: 4, name: 'Lightning Bolt' }]) => ({
    playerId,
    archetype: 'Burn',
    main,
    sideboard: [{ quantity: 2, name: 'Lightning Bolt' }],
  });

  const states = {
    setup: () => reduceLog(registeredLog(4)),
    running: () => reduceLog(round1Open()),
    topCut: () => reduceLog(semisOpen()),
    finished: () => reduceLog(swissDone().add('TournamentFinished', {})),
  };

  it.each(Object.keys(states) as (keyof typeof states)[])('accepts a deck while %s', (status) => {
    const state = states[status]();
    expect(state.status).toBe(status);
    expect(validateNext(state, 'DeckSet', deck(P1))).toBeNull();
  });

  it('accepts a deck for a guest and for a dropped player', () => {
    const state = reduceLog(
      registeredLog(4)
        .add('PlayerRegistered', { playerId: P5, playerName: 'Guest', guest: true })
        .add('PlayerDropped', { playerId: P2 }),
    );
    expect(validateNext(state, 'DeckSet', deck(P5))).toBeNull();
    expect(validateNext(state, 'DeckSet', deck(P2))).toBeNull();
  });

  it('accepts an empty deck (clear)', () => {
    const empty = { playerId: P1, main: [], sideboard: [] };
    expect(validateNext(reduceLog(registeredLog(4)), 'DeckSet', empty)).toBeNull();
  });

  it('rejects an unknown player with UNKNOWN_PLAYER', () => {
    expect(validateNext(reduceLog(registeredLog(4)), 'DeckSet', deck(P5))).toMatchObject({
      code: 'UNKNOWN_PLAYER',
      seq: 6,
    });
  });

  it('rejects a name listed twice in one section (case-insensitive) with INVALID_DECK', () => {
    const main = [
      { quantity: 4, name: 'Lightning Bolt' },
      { quantity: 1, name: 'lightning bolt' },
    ];
    expect(validateNext(reduceLog(registeredLog(4)), 'DeckSet', deck(P1, main))).toMatchObject({
      code: 'INVALID_DECK',
      seq: 6,
    });
  });
});
