import { describe, expect, it } from 'vitest';
import {
  PLAYERS,
  TOURNAMENT_ID,
  WIN_A,
  addClosedRound,
  matchId,
  pairing,
  registeredLog,
  uuid,
} from './fixtures/builders';
import { historyOf, rollbackPreview } from './history';
import { reduce, stateAt } from './reduce';

const [P1, P2, P3, P4] = PLAYERS;

/** Seqs 1–5: created, 4 registered. 6: round 1 paired. 7–8: results. 9: round closed. */
function closedRoundLog() {
  return addClosedRound(registeredLog(4), 1, 'swiss', [
    pairing(1, 1, P1, P2),
    pairing(2, 2, P3, P4),
  ]);
}

describe('historyOf', () => {
  it('lists every event newest first and marks voided ones', () => {
    const log = closedRoundLog().add('RolledBack', { toSeq: 7 });
    const { entries } = historyOf(log.events, TOURNAMENT_ID);
    const { voidedSeqs } = reduce(log.events, TOURNAMENT_ID);

    expect(entries.map((e) => e.event.seq)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    for (const entry of entries) {
      expect(entry.voided).toBe(voidedSeqs.includes(entry.event.seq));
    }
    expect(voidedSeqs).toEqual([8, 9]);
  });

  it('allows a rollback only to effective events below the newest effective one', () => {
    const log = closedRoundLog().add('RolledBack', { toSeq: 7 }).add('PlayerDropped', {
      playerId: P1,
    });
    const { entries } = historyOf(log.events, TOURNAMENT_ID);
    const allowed = entries.filter((e) => e.canRollBackTo).map((e) => e.event.seq);

    // 11 is the newest effective event, 10 is a RolledBack, 8 and 9 are voided.
    expect(allowed).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it('allows no rollback on a log with one event', () => {
    const log = registeredLog(0);
    expect(historyOf(log.events, TOURNAMENT_ID).entries).toEqual([
      { event: log.events[0], voided: false, canRollBackTo: false },
    ]);
  });

  it('resolves the name of a voided registration', () => {
    const log = registeredLog(2)
      .add('PlayerRegistered', { playerId: P3, playerName: 'Late' })
      .add('RolledBack', { toSeq: 3 });
    const { playerNames, entries } = historyOf(log.events, TOURNAMENT_ID);

    expect(entries.find((e) => e.event.seq === 4)?.voided).toBe(true);
    expect(playerNames[P3]).toBe('Late');
  });

  it('resolves a result after a swap to the swapped players', () => {
    const log = registeredLog(4)
      .add('RoundPaired', {
        round: 1,
        stage: 'swiss',
        pairings: [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)],
      })
      .add('PlayersSwapped', { round: 1, playerA: P2, playerB: P3 })
      .add('ResultReported', { matchId: matchId(1), result: WIN_A });
    const { matches } = historyOf(log.events, TOURNAMENT_ID);

    expect(matches[matchId(1)]).toEqual({ round: 1, playerA: P1, playerB: P3 });
    expect(matches[matchId(2)]).toEqual({ round: 1, playerA: P2, playerB: P4 });
  });

  it('keeps the matches of a voided round', () => {
    const log = registeredLog(3)
      .add('RoundPaired', {
        round: 1,
        stage: 'swiss',
        pairings: [pairing(1, 1, P1, P2), pairing(2, 2, P3, null)],
      })
      .add('RolledBack', { toSeq: 4 });
    const { matches } = historyOf(log.events, TOURNAMENT_ID);

    expect(matches[matchId(2)]).toEqual({ round: 1, playerA: P3, playerB: null });
  });
});

describe('rollbackPreview', () => {
  it('lists the effective events above the target and returns the state at it', () => {
    const log = closedRoundLog();
    const preview = rollbackPreview(log.events, 6, TOURNAMENT_ID);

    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.undone.map((e) => [e.seq, e.type])).toEqual([
        [7, 'ResultReported'],
        [8, 'ResultReported'],
        [9, 'RoundClosed'],
      ]);
      expect(preview.value.after).toEqual(stateAt(log.events, 6, TOURNAMENT_ID));
      expect(preview.value.after.rounds[0].closed).toBe(false);
    }
  });

  it('skips events voided by an earlier rollback', () => {
    const log = closedRoundLog()
      .add('RolledBack', { toSeq: 7 })
      .add('PlayerRegistered', { playerId: uuid(150), playerName: 'Late' });
    const preview = rollbackPreview(log.events, 6, TOURNAMENT_ID);

    expect(preview.ok && preview.value.undone.map((e) => e.seq)).toEqual([7, 11]);
  });

  it.each([
    ['a voided target', 8],
    ['a RolledBack target', 10],
    ['the last seq', 11],
    ['a seq past the end', 99],
  ])('returns INVALID_ROLLBACK_TARGET for %s', (_, toSeq) => {
    const log = closedRoundLog()
      .add('RolledBack', { toSeq: 7 })
      .add('PlayerDropped', { playerId: P1 });
    expect(rollbackPreview(log.events, toSeq, TOURNAMENT_ID)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ROLLBACK_TARGET' },
    });
  });
});
