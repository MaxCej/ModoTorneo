import type { TournamentDocument } from '../schemas/document.ts';
import type { MatchResult } from '../schemas/matchResult.ts';
import { PLAYERS, TOURNAMENT_ID, logBuilder, matchId, pairing } from './builders.ts';

const [P1, P2, P3, P4, P5, P6, P7, P8] = PLAYERS;
const NAMES = ['Alice', 'Bruno', 'Carmen', 'Diego', 'Elena', 'Fabio', 'Gala', 'Hugo'];

function played(winsA: number, winsB: number, draws = 0): MatchResult {
  return { winsA, winsB, draws, kind: 'played' };
}

/**
 * Source of `top4-8players.json`: 8 players, one drop, 3 swiss rounds, Top 4,
 * one corrected result and one rollback (round 3 paired again).
 * Regenerate with `node src/domain/fixtures/generate.ts > src/domain/fixtures/top4-8players.json`,
 * then `pnpm format`.
 */
export function buildTop4Fixture(): TournamentDocument {
  const log = logBuilder();
  for (const [i, playerId] of PLAYERS.entries()) {
    log.add('PlayerRegistered', { playerId, playerName: NAMES[i] });
  }

  // Round 1. Match 2 is first reported 2-0, then corrected to 0-2.
  log
    .add('RoundPaired', {
      round: 1,
      stage: 'swiss',
      pairings: [
        pairing(1, 1, P1, P2),
        pairing(2, 2, P3, P4),
        pairing(3, 3, P5, P6),
        pairing(4, 4, P7, P8),
      ],
    })
    .add('ResultReported', { matchId: matchId(1), result: played(2, 1) })
    .add('ResultReported', { matchId: matchId(2), result: played(2, 0) })
    .add('ResultReported', { matchId: matchId(3), result: played(2, 1) })
    .add('ResultReported', { matchId: matchId(4), result: played(2, 0) })
    .add('ResultReported', { matchId: matchId(2), result: played(0, 2) })
    .add('RoundClosed', { round: 1 })
    .add('PlayerDropped', { playerId: P8 });

  // Round 2: 7 active players, so one bye. Match 6 is a draw.
  log
    .add('RoundPaired', {
      round: 2,
      stage: 'swiss',
      pairings: [
        pairing(5, 1, P1, P4),
        pairing(6, 2, P5, P7),
        pairing(7, 3, P2, P3),
        pairing(8, 4, P6, null),
      ],
    })
    .add('ResultReported', { matchId: matchId(5), result: played(2, 1) })
    .add('ResultReported', { matchId: matchId(6), result: played(1, 1, 1) })
    .add('ResultReported', { matchId: matchId(7), result: played(2, 0) })
    .add('RoundClosed', { round: 2 });
  const round2Closed = log.events.length;

  // Round 3: paired, rolled back to the close of round 2 and paired again.
  log
    .add('RoundPaired', {
      round: 3,
      stage: 'swiss',
      pairings: [
        pairing(9, 1, P1, P5),
        pairing(10, 2, P7, P4),
        pairing(11, 3, P2, P6),
        pairing(12, 4, P3, null),
      ],
    })
    .add('RolledBack', { toSeq: round2Closed })
    .add('RoundPaired', {
      round: 3,
      stage: 'swiss',
      pairings: [
        pairing(13, 1, P1, P7),
        pairing(14, 2, P5, P4),
        pairing(15, 3, P2, P6),
        pairing(16, 4, P3, null),
      ],
    })
    .add('ResultReported', { matchId: matchId(13), result: played(2, 0) })
    .add('ResultReported', { matchId: matchId(14), result: played(0, 2) })
    .add('ResultReported', { matchId: matchId(15), result: played(2, 1) })
    .add('RoundClosed', { round: 3 });

  // Top 4: semifinals, then the final.
  log
    .add('TopCutStarted', { size: 4 })
    .add('RoundPaired', {
      round: 4,
      stage: 'topCut',
      pairings: [pairing(17, 1, P1, P5), pairing(18, 2, P4, P2)],
    })
    .add('ResultReported', { matchId: matchId(17), result: played(2, 1) })
    .add('ResultReported', { matchId: matchId(18), result: played(2, 0) })
    .add('RoundClosed', { round: 4 })
    .add('RoundPaired', { round: 5, stage: 'topCut', pairings: [pairing(19, 1, P1, P4)] })
    .add('ResultReported', { matchId: matchId(19), result: played(1, 2) })
    .add('RoundClosed', { round: 5 })
    .add('TournamentFinished', {});

  return { schemaVersion: 1, id: TOURNAMENT_ID, events: log.events };
}
