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
import {
  playerProfile,
  playerResults,
  playerTotals,
  type PlayerResult,
  type TournamentResults,
} from './playerStats';
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

type ResultParts = {
  swiss?: [number, number, number];
  games?: [number, number, number];
  byes?: number;
  topCut?: [number, number, number, number, number] | null; // wins, losses, games won, lost, drawn
  placing?: [number, number] | null;
};

function result(playerId: string, parts: ResultParts = {}): PlayerResult {
  const [wins, losses, draws] = parts.swiss ?? [0, 0, 0];
  const [won, lost, drawn] = parts.games ?? [0, 0, 0];
  const topCut = parts.topCut ?? null;
  const placing = parts.placing ?? null;
  return {
    playerId,
    playerName: 'Name',
    dropped: false,
    swiss: { wins, losses, draws, byes: parts.byes ?? 0, unplayed: 0, games: { won, lost, drawn } },
    topCut:
      topCut === null
        ? null
        : {
            wins: topCut[0],
            losses: topCut[1],
            draws: 0,
            games: { won: topCut[2], lost: topCut[3], drawn: topCut[4] },
          },
    swissRank: null,
    placing: placing === null ? null : { from: placing[0], to: placing[1] },
  };
}

function tournament(
  n: number,
  players: PlayerResult[],
  overrides: Partial<TournamentResults> = {},
): TournamentResults {
  return {
    id: uuid(500 + n),
    name: `Tournament ${n}`,
    date: '2026-10-01',
    format: 'modern',
    status: 'finished',
    playerCount: players.length,
    players,
    ...overrides,
  };
}

describe('playerTotals', () => {
  it('adds swiss and top cut, and computes rates without a floor', () => {
    const totals = playerTotals([
      tournament(1, [
        result(P1, {
          swiss: [3, 2, 1],
          games: [7, 5, 1],
          byes: 1,
          topCut: [2, 1, 5, 3, 0],
          placing: [2, 2],
        }),
        result(P2, { swiss: [0, 3, 0], games: [0, 6, 0] }),
      ]),
    ]);
    expect(totals[P1]).toEqual({
      tournaments: 1,
      matches: { wins: 5, losses: 3, draws: 1 },
      games: { won: 12, lost: 8, drawn: 1 },
      byes: 1,
      topCuts: 1,
      matchWinRate: 5 / 9,
      gameWinRate: 12 / 21,
      lastPlayed: '2026-10-01',
    });
    expect(totals[P2].matchWinRate).toBe(0);
    expect(totals[P2].gameWinRate).toBe(0);
  });

  it('counts a tournament with zero matches, with null rates', () => {
    const totals = playerTotals([
      tournament(1, [result(P1)], { date: '2026-09-01' }),
      tournament(2, [result(P1, { byes: 1 })], { date: '2026-10-05' }),
    ]);
    expect(totals[P1]).toMatchObject({
      tournaments: 2,
      byes: 1,
      matchWinRate: null,
      gameWinRate: null,
      lastPlayed: '2026-10-05',
    });
    expect(Object.keys(totals)).toEqual([P1]);
  });
});

describe('playerProfile', () => {
  const tournaments = [
    tournament(1, [result(P1, { swiss: [1, 0, 0], games: [2, 0, 0], placing: [3, 4] })], {
      date: '2026-09-01',
      format: 'pauper',
    }),
    tournament(2, [result(P1, { swiss: [0, 1, 0], games: [1, 2, 0] })], {
      date: '2026-10-05',
      name: 'Beta',
    }),
    tournament(3, [result(P1, { swiss: [2, 0, 0], games: [4, 1, 0], placing: [1, 1] })], {
      date: '2026-10-05',
      name: 'Alpha',
      format: 'standard',
    }),
    tournament(4, [result(P2, { placing: [1, 1] })]),
  ];

  it('lists formats played in FormatSchema order', () => {
    const profile = playerProfile(P1, tournaments);
    expect(profile.byFormat.map((row) => [row.format, row.tournaments])).toEqual([
      ['standard', 1],
      ['modern', 1],
      ['pauper', 1],
    ]);
    expect(profile.byFormat[0].matchWinRate).toBe(1);
    expect(profile.totals.matches).toEqual({ wins: 3, losses: 1, draws: 0 });
  });

  it('orders history by date descending, then name, then id', () => {
    const sameDay = tournament(5, [result(P1)], { date: '2026-10-05', name: 'Alpha' });
    const profile = playerProfile(P1, [...tournaments, sameDay]);
    expect(profile.history.map((row) => row.id)).toEqual([
      uuid(503),
      uuid(505),
      uuid(502),
      uuid(501),
    ]);
    expect(profile.history[0].result.playerId).toBe(P1);
  });

  it('picks the lowest placing', () => {
    expect(playerProfile(P1, tournaments).bestPlacing).toEqual({ from: 1, to: 1 });
    expect(
      playerProfile(P1, [
        tournament(1, [result(P1, { placing: [5, 8] })]),
        tournament(2, [result(P1, { placing: [3, 4] })]),
      ]).bestPlacing,
    ).toEqual({ from: 3, to: 4 });
  });

  it('gives an unknown id zero totals and empty lists', () => {
    expect(playerProfile(uuid(999), tournaments)).toEqual({
      totals: {
        tournaments: 0,
        matches: { wins: 0, losses: 0, draws: 0 },
        games: { won: 0, lost: 0, drawn: 0 },
        byes: 0,
        topCuts: 0,
        matchWinRate: null,
        gameWinRate: null,
        lastPlayed: null,
      },
      byFormat: [],
      history: [],
      bestPlacing: null,
    });
  });
});
