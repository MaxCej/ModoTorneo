import { describe, expect, it } from 'vitest';
import {
  PLAYERS,
  TOURNAMENT_ID,
  pairing,
  registeredLog,
  swissHistory,
  uuid,
  type LogBuilder,
} from './fixtures/builders';
import fixture from './fixtures/top4-8players.json';
import { playerResults } from './playerStats';
import { reduce } from './reduce';
import type { TournamentDocument } from './schemas/document';
import type { MatchResult } from './schemas/matchResult';
import { standings } from './standings';

const [P1, P2, P3, P4, P5, P6, P7, P8] = PLAYERS;

const played = (winsA: number, winsB: number, draws = 0): MatchResult => ({
  winsA,
  winsB,
  draws,
  kind: 'played',
});
const ID: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' };
const UNPLAYED: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'unplayed' };

const stateOf = (log: LogBuilder) => reduce(log.events, TOURNAMENT_ID);
const resultOf = (log: LogBuilder, playerId: string) => {
  const result = playerResults(stateOf(log)).find((r) => r.playerId === playerId);
  if (result === undefined) {
    throw new Error(`no result for ${playerId}`);
  }
  return result;
};

describe('playerResults', () => {
  it('gives guests no row, and dropped players and late entries one', () => {
    const guest = uuid(900);
    const late = uuid(901);
    const log = swissHistory(
      [P1, P2, P3, P4],
      [
        [
          [P1, P2],
          [P3, P4],
        ],
      ],
    );
    log.add('PlayerRegistered', { playerId: guest, playerName: 'Guest', guest: true });
    log.add('PlayerRegistered', { playerId: late, playerName: 'Late' });
    log.add('PlayerDropped', { playerId: P4 });

    const results = playerResults(stateOf(log));
    expect(results.map((r) => r.playerId)).toEqual([P1, P2, P3, P4, late]);
    expect(results.find((r) => r.playerId === P4)?.dropped).toBe(true);
    expect(results.find((r) => r.playerId === late)).toMatchObject({
      dropped: false,
      playerName: 'Late',
      swiss: { wins: 0, losses: 0, draws: 0, byes: 0, unplayed: 0 },
    });
  });

  it('counts a 2-1 win and a 1-1-1 draw with their games', () => {
    const log = swissHistory([P1, P2], [[[P1, P2, played(2, 1)]], [[P1, P2, played(1, 1, 1)]]]);
    expect(resultOf(log, P1).swiss).toEqual({
      wins: 1,
      losses: 0,
      draws: 1,
      byes: 0,
      unplayed: 0,
      games: { won: 3, lost: 2, drawn: 1 },
    });
    expect(resultOf(log, P2).swiss).toMatchObject({
      wins: 0,
      losses: 1,
      draws: 1,
      games: { won: 2, lost: 3, drawn: 1 },
    });
  });

  it('counts byes and unplayed matches on their own, and intentional draws without games', () => {
    const log = swissHistory(
      [P1, P2, P3],
      [
        [
          [P1, P2, UNPLAYED],
          [P3, null],
        ],
        [
          [P1, P3, ID],
          [P2, null],
        ],
      ],
    );
    expect(resultOf(log, P1).swiss).toEqual({
      wins: 0,
      losses: 0,
      draws: 1,
      byes: 0,
      unplayed: 1,
      games: { won: 0, lost: 0, drawn: 0 },
    });
    expect(resultOf(log, P3).swiss).toEqual({
      wins: 0,
      losses: 0,
      draws: 1,
      byes: 1,
      unplayed: 0,
      games: { won: 0, lost: 0, drawn: 0 },
    });
  });

  it('ignores unreported matches', () => {
    const log = registeredLog(2).add('RoundPaired', {
      round: 1,
      stage: 'swiss',
      pairings: [pairing(1, 1, P1, P2)],
    });
    expect(resultOf(log, P1).swiss).toMatchObject({ wins: 0, losses: 0, draws: 0 });
    expect(resultOf(log, P1).swiss.games).toEqual({ won: 0, lost: 0, drawn: 0 });
  });

  it('gives a null swiss rank when no swiss round is closed', () => {
    const log = registeredLog(2);
    expect(playerResults(stateOf(log)).map((r) => r.swissRank)).toEqual([null, null]);
  });

  it('matches standings and placings in the SPEC 02 fixture', () => {
    const doc = fixture as TournamentDocument;
    const state = reduce(doc.events, doc.id);
    const results = playerResults(state);

    expect(results.find((r) => r.playerId === P4)?.placing).toEqual({ from: 1, to: 1 });
    expect(results.find((r) => r.playerId === P1)?.placing).toEqual({ from: 2, to: 2 });
    for (const standing of standings(state)) {
      expect(results.find((r) => r.playerId === standing.playerId)?.swissRank).toBe(standing.rank);
    }
    const inTopCut = new Set(
      state.rounds
        .filter((round) => round.stage === 'topCut')
        .flatMap((round) => round.matches.flatMap((m) => [m.playerA, m.playerB])),
    );
    expect(inTopCut.size).toBe(4);
    for (const result of results) {
      expect(result.topCut !== null).toBe(inTopCut.has(result.playerId));
      expect(result.placing !== null).toBe(inTopCut.has(result.playerId));
    }
    expect(results.map((r) => r.playerId)).toEqual([P1, P2, P3, P4, P5, P6, P7, P8]);
  });
});
