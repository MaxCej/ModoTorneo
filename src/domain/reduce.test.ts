import { describe, expect, it } from 'vitest';
import { CorruptLogError, type DomainError } from './errors';
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
} from './fixtures/builders';
import { apply, effectiveEvents, reduce, stateAt } from './reduce';
import type { Pairing, TournamentEvent } from './schemas/events';
import { IMPLICIT_BYE_RESULT, type MatchResult } from './schemas/matchResult';
import type { TournamentState } from './state';

const [P1, P2, P3, P4, P5] = PLAYERS;

const WIN_B: MatchResult = { winsA: 0, winsB: 2, draws: 0, kind: 'played' };

const swiss = (round: number, pairings: Pairing[]) => ({
  round,
  stage: 'swiss' as const,
  pairings,
});

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
      [P1]: {
        playerId: P1,
        playerName: 'Alice',
        deckId,
        guest: false,
        dropped: false,
        registeredAtRound: 0,
      },
      [P2]: { playerId: P2, playerName: 'Bob', guest: false, dropped: false, registeredAtRound: 0 },
    });
    expect(state.players[P2]).not.toHaveProperty('deckId');
    expect(state.lastSeq).toBe(3);
  });

  it('stores the guest flag, false when the event omits it', () => {
    const { events } = logBuilder()
      .add('PlayerRegistered', { playerId: P1, playerName: 'Alice' })
      .add('PlayerRegistered', { playerId: P2, playerName: 'Bob', guest: false })
      .add('PlayerRegistered', { playerId: P3, playerName: 'Guest', guest: true });

    const { players } = reduce(events, TOURNAMENT_ID);

    expect(players[P1].guest).toBe(false);
    expect(players[P2].guest).toBe(false);
    expect(players[P3].guest).toBe(true);
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

describe('reduce: swiss rounds', () => {
  it('adds the paired round and moves status from setup to running', () => {
    const { events } = registeredLog(4).add(
      'RoundPaired',
      swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)]),
    );

    const state = reduce(events, TOURNAMENT_ID);

    expect(state.status).toBe('running');
    expect(state.rounds).toEqual([
      {
        number: 1,
        stage: 'swiss',
        closed: false,
        matches: [
          { ...pairing(1, 1, P1, P2), result: null },
          { ...pairing(2, 2, P3, P4), result: null },
        ],
      },
    ]);
  });

  it('gives a bye its implicit 2-0 result', () => {
    const { events } = registeredLog(3).add(
      'RoundPaired',
      swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, null)]),
    );

    const bye = reduce(events, TOURNAMENT_ID).rounds[0].matches[1];

    expect(bye.result).toEqual(IMPLICIT_BYE_RESULT);
    expect(bye.result).toEqual({ winsA: 2, winsB: 0, draws: 0, kind: 'played' });
  });

  it('stores a reported result on its match', () => {
    const { events } = registeredLog(4)
      .add('RoundPaired', swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)]))
      .add('ResultReported', { matchId: matchId(2), result: WIN_B });

    const [first, second] = reduce(events, TOURNAMENT_ID).rounds[0].matches;

    expect(first.result).toBeNull();
    expect(second.result).toEqual(WIN_B);
  });

  it('replaces the first result when a match is reported twice', () => {
    const { events } = registeredLog(4)
      .add('RoundPaired', swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)]))
      .add('ResultReported', { matchId: matchId(1), result: WIN_A })
      .add('ResultReported', { matchId: matchId(1), result: WIN_B });

    expect(reduce(events, TOURNAMENT_ID).rounds[0].matches[0].result).toEqual(WIN_B);
  });

  it('closes the round and accepts the next one', () => {
    const { events } = registeredLog(4)
      .add('RoundPaired', swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)]))
      .add('ResultReported', { matchId: matchId(1), result: WIN_A })
      .add('ResultReported', { matchId: matchId(2), result: WIN_A })
      .add('RoundClosed', { round: 1 })
      .add('RoundPaired', swiss(2, [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)]));

    const state = reduce(events, TOURNAMENT_ID);

    expect(state.rounds.map((r) => [r.number, r.closed])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(state.status).toBe('running');
  });

  it('registers a late entry for the next round', () => {
    const { events } = registeredLog(4)
      .add('RoundPaired', swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)]))
      .add('PlayerRegistered', { playerId: P5, playerName: 'Late' })
      .add('ResultReported', { matchId: matchId(1), result: WIN_A })
      .add('ResultReported', { matchId: matchId(2), result: WIN_A })
      .add('RoundClosed', { round: 1 })
      .add(
        'RoundPaired',
        swiss(2, [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4), pairing(5, 3, P5, null)]),
      );

    const state = reduce(events, TOURNAMENT_ID);

    expect(state.players[P5].registeredAtRound).toBe(1);
    expect(state.rounds[1].matches).toHaveLength(3);
  });

  it('throws INVALID_PAIRINGS on replay of a pairing that omits an active player', () => {
    const { events } = registeredLog(4).add(
      'RoundPaired',
      swiss(1, [pairing(1, 1, P1, P2), pairing(2, 2, P3, null)]),
    );
    expect(corruptError(events)).toMatchObject({ code: 'INVALID_PAIRINGS', seq: 6 });
  });
});

describe('reduce: top cut and finish', () => {
  const twoRounds = { ...CREATED_PAYLOAD, swissRounds: 2 };
  const swissDone = () =>
    addClosedRound(
      addClosedRound(registeredLog(4, twoRounds), 1, 'swiss', [
        pairing(1, 1, P1, P2),
        pairing(2, 2, P3, P4),
      ]),
      2,
      'swiss',
      [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)],
    );

  it('starts with no top cut chosen', () => {
    expect(reduce(swissDone().events, TOURNAMENT_ID).topCut).toBeNull();
  });

  it('records the chosen size and moves status to topCut on TopCutStarted', () => {
    const { events } = swissDone().add('TopCutStarted', { size: 4 });
    expect(reduce(events, TOURNAMENT_ID)).toMatchObject({ status: 'topCut', topCut: 4 });
  });

  it('adds top cut rounds with stage topCut and finishes the tournament', () => {
    const log = swissDone().add('TopCutStarted', { size: 4 });
    addClosedRound(log, 3, 'topCut', [pairing(5, 1, P1, P4), pairing(6, 2, P2, P3)]);
    addClosedRound(log, 4, 'topCut', [pairing(7, 1, P1, P2)]);
    log.add('TournamentFinished', {});

    const state = reduce(log.events, TOURNAMENT_ID);

    expect(state.status).toBe('finished');
    expect(state.rounds.map((r) => [r.number, r.stage, r.closed])).toEqual([
      [1, 'swiss', true],
      [2, 'swiss', true],
      [3, 'topCut', true],
      [4, 'topCut', true],
    ]);
    expect(state.rounds[3].matches[0].result).toEqual(WIN_A);
  });

  it('finishes without a top cut after stopping swiss early', () => {
    const log = addClosedRound(registeredLog(2, twoRounds), 1, 'swiss', [
      pairing(1, 1, P1, P2),
    ]).add('TournamentFinished', {});
    expect(reduce(log.events, TOURNAMENT_ID)).toMatchObject({ status: 'finished', topCut: null });
  });

  it('throws TOP_CUT_DRAW on replay of a drawn top cut match', () => {
    const { events } = swissDone()
      .add('TopCutStarted', { size: 4 })
      .add('RoundPaired', { round: 3, stage: 'topCut', pairings: [pairing(5, 1, P1, P4)] })
      .add('ResultReported', {
        matchId: matchId(5),
        result: { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' },
      });
    expect(corruptError(events)).toMatchObject({ code: 'TOP_CUT_DRAW' });
  });
});

describe('rollback', () => {
  const twoRounds = { ...CREATED_PAYLOAD, swissRounds: 2 };

  /** Domain fields only: drops the log bookkeeping (`lastSeq`, `voidedSeqs`, `effectiveSeqs`). */
  const domain = (state: TournamentState) => {
    const rest: Partial<TournamentState> = { ...state };
    delete rest.lastSeq;
    delete rest.voidedSeqs;
    delete rest.effectiveSeqs;
    return rest;
  };

  const seqs = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  /**
   * seq 1 created, 2–5 register P1–P4, 6 pair round 1 (matches 1, 2), 7–8 results,
   * 9 close round 1, 10 pair round 2 (matches 3, 4), 11 result for match 3.
   */
  const round2InProgress = () =>
    addClosedRound(registeredLog(4, twoRounds), 1, 'swiss', [
      pairing(1, 1, P1, P2),
      pairing(2, 2, P3, P4),
    ])
      .add('RoundPaired', swiss(2, [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)]))
      .add('ResultReported', { matchId: matchId(3), result: WIN_A });

  it('undoes a result mid-round', () => {
    const log = round2InProgress();
    const before = reduce(log.events.slice(0, 10), TOURNAMENT_ID);
    log.add('RolledBack', { toSeq: 10 });

    const state = reduce(log.events, TOURNAMENT_ID);

    expect(domain(state)).toEqual(domain(before));
    expect(state.rounds[1].matches[0].result).toBeNull();
    expect(state).toMatchObject({ lastSeq: 12, voidedSeqs: [11], effectiveSeqs: seqs(1, 10) });
  });

  it('reopens a closed round and accepts a corrected result', () => {
    const log = round2InProgress().add('RolledBack', { toSeq: 8 });
    expect(reduce(log.events, TOURNAMENT_ID).rounds).toHaveLength(1);
    expect(reduce(log.events, TOURNAMENT_ID).rounds[0].closed).toBe(false);

    log
      .add('ResultReported', { matchId: matchId(2), result: WIN_B })
      .add('RoundClosed', { round: 1 });
    const state = reduce(log.events, TOURNAMENT_ID);

    expect(state.rounds[0]).toMatchObject({ closed: true });
    expect(state.rounds[0].matches[1].result).toEqual(WIN_B);
    expect(state.voidedSeqs).toEqual([9, 10, 11]);
  });

  it('rolls back a finished tournament', () => {
    const log = addClosedRound(registeredLog(4, twoRounds), 1, 'swiss', [
      pairing(1, 1, P1, P2),
      pairing(2, 2, P3, P4),
    ]).add('TournamentFinished', {});
    expect(reduce(log.events, TOURNAMENT_ID).status).toBe('finished');

    log.add('RolledBack', { toSeq: 9 }).add('TopCutStarted', { size: 4 });
    const state = reduce(log.events, TOURNAMENT_ID);

    expect(state).toMatchObject({ status: 'topCut', topCut: 4, voidedSeqs: [10] });
  });

  it('chains rollbacks and accumulates the voided seqs', () => {
    const log = round2InProgress()
      .add('RolledBack', { toSeq: 10 }) // seq 12 voids 11
      .add('ResultReported', { matchId: matchId(4), result: WIN_A }) // seq 13
      .add('RolledBack', { toSeq: 8 }); // seq 14 voids 9, 10, 13

    const state = reduce(log.events, TOURNAMENT_ID);

    expect(domain(state)).toEqual(domain(reduce(log.events.slice(0, 8), TOURNAMENT_ID)));
    expect(state).toMatchObject({
      lastSeq: 14,
      voidedSeqs: [9, 10, 11, 13],
      effectiveSeqs: seqs(1, 8),
    });
  });

  it.each([
    ['a voided seq', 11],
    ['the seq of a RolledBack event', 12],
    ['the last seq', 13],
    ['a seq after the log', 20],
  ])('throws INVALID_ROLLBACK_TARGET for %s', (_, toSeq) => {
    const log = round2InProgress()
      .add('RolledBack', { toSeq: 10 })
      .add('ResultReported', { matchId: matchId(4), result: WIN_A })
      .add('RolledBack', { toSeq });
    expect(corruptError(log.events)).toMatchObject({ code: 'INVALID_ROLLBACK_TARGET', seq: 14 });
  });

  it('redoes matchmaking: rollback before RoundPaired, then pair again', () => {
    const log = round2InProgress()
      .add('RolledBack', { toSeq: 9 })
      .add('RoundPaired', swiss(2, [pairing(5, 1, P1, P4), pairing(6, 2, P2, P3)]));

    const state = reduce(log.events, TOURNAMENT_ID);

    expect(state.rounds[1].matches.map((m) => m.matchId)).toEqual([matchId(5), matchId(6)]);
    expect(state.rounds[1].matches.every((m) => m.result === null)).toBe(true);
    expect(state.voidedSeqs).toEqual([10, 11]);
  });

  it('allows a voided match id to be paired again', () => {
    const log = round2InProgress()
      .add('RolledBack', { toSeq: 9 })
      .add('RoundPaired', swiss(2, [pairing(3, 1, P1, P4), pairing(4, 2, P2, P3)]));
    expect(reduce(log.events, TOURNAMENT_ID).rounds[1].matches[0].playerB).toBe(P4);
  });
});

describe('effectiveEvents', () => {
  it('returns every event of a log without rollbacks', () => {
    const { events } = registeredLog(2);
    expect(effectiveEvents(events)).toEqual(events);
  });

  it('drops voided events and RolledBack events', () => {
    const { events } = registeredLog(4, { ...CREATED_PAYLOAD, swissRounds: 2 })
      .add('PlayerDropped', { playerId: P4 }) // seq 6
      .add('RolledBack', { toSeq: 5 }) // seq 7 voids 6
      .add('PlayerDropped', { playerId: P3 }) // seq 8
      .add('RolledBack', { toSeq: 3 }); // seq 9 voids 4, 5, 8

    expect(effectiveEvents(events).map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe('stateAt', () => {
  /** Rollback at seq 7 voids seq 6; seq 8 drops P3. */
  const log = () =>
    registeredLog(4)
      .add('PlayerDropped', { playerId: P4 })
      .add('RolledBack', { toSeq: 5 })
      .add('PlayerDropped', { playerId: P3 });

  it('equals reduce of the log prefix when no rollback came before', () => {
    const { events } = log();
    expect(stateAt(events, 4, TOURNAMENT_ID)).toEqual(reduce(events.slice(0, 4), TOURNAMENT_ID));
  });

  it('returns the snapshot of the last effective event at or before seq', () => {
    const { events } = log();
    // 6 is voided and 7 is the RolledBack, so the snapshot is the one after seq 5.
    expect(stateAt(events, 7, TOURNAMENT_ID)).toMatchObject({ lastSeq: 5, voidedSeqs: [] });
    expect(stateAt(events, 6, TOURNAMENT_ID).players[P4].dropped).toBe(false);
  });

  it('keeps the bookkeeping of a snapshot taken after a rollback', () => {
    const state = stateAt(log().events, 8, TOURNAMENT_ID);
    expect(state).toMatchObject({ lastSeq: 8, voidedSeqs: [6], effectiveSeqs: [1, 2, 3, 4, 5, 8] });
    expect(state.players[P3].dropped).toBe(true);
  });

  it('throws for a seq before the first event', () => {
    expect(() => stateAt(log().events, 0, TOURNAMENT_ID)).toThrow(RangeError);
  });
});

describe('apply', () => {
  it('throws for RolledBack, which only reduce handles', () => {
    const state = reduce(registeredLog(1).events, TOURNAMENT_ID);
    expect(() => apply(state, event(3, 'RolledBack', { toSeq: 1 }), TOURNAMENT_ID)).toThrow();
  });

  it('never mutates the input state', () => {
    const { events } = logBuilder().add('PlayerRegistered', { playerId: P1, playerName: 'Alice' });
    const state = reduce(events, TOURNAMENT_ID);
    const snapshot = structuredClone(state);

    apply(state, event(3, 'PlayerRegistered', { playerId: P2, playerName: 'Bob' }), TOURNAMENT_ID);
    apply(state, event(3, 'PlayerDropped', { playerId: P1 }), TOURNAMENT_ID);

    expect(state).toEqual(snapshot);
  });
});
