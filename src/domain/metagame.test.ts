import { describe, expect, it } from 'vitest';
import {
  PLAYERS,
  TOURNAMENT_ID,
  event,
  pairing,
  registeredLog,
  swissHistory,
  type LogBuilder,
} from './fixtures/builders';
import fixture from './fixtures/top4-8players.json';
import { tournamentMetagame } from './metagame';
import { reduce } from './reduce';
import type { TournamentDocument } from './schemas/document';
import type { MatchResult } from './schemas/matchResult';

const [P1, P2, P3, P4, P5, P6, P7, P8] = PLAYERS;

const played = (winsA: number, winsB: number, draws = 0): MatchResult => ({
  winsA,
  winsB,
  draws,
  kind: 'played',
});
const ID: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' };
const UNPLAYED: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'unplayed' };

const metagameOf = (log: LogBuilder) => tournamentMetagame(reduce(log.events, TOURNAMENT_ID));

function withDecks(log: LogBuilder, decks: [string, string][]): LogBuilder {
  for (const [playerId, archetype] of decks) {
    log.add('DeckSet', { playerId, archetype, main: [], sideboard: [] });
  }
  return log;
}

describe('tournamentMetagame', () => {
  it('counts players per archetype, guests and dropped players included, Unknown last', () => {
    const log = registeredLog(4)
      .add('PlayerRegistered', { playerId: P5, playerName: 'Guest', guest: true })
      .add('PlayerDropped', { playerId: P2 });
    withDecks(log, [
      [P1, 'Burn'],
      [P2, 'Burn'],
      [P5, 'Affinity'],
    ]);

    expect(metagameOf(log).archetypes).toEqual([
      { archetype: 'Affinity', players: 1, topCut: 0 },
      { archetype: 'Burn', players: 2, topCut: 0 },
      { archetype: null, players: 2, topCut: 0 },
    ]);
  });

  it('groups labels differing only by case with the first spelling in registration order', () => {
    const log = withDecks(registeredLog(3), [
      [P3, 'BURN'],
      [P1, 'burn'],
      [P2, 'Burn'],
    ]);
    const { archetypes } = metagameOf(log);
    expect(archetypes).toEqual([{ archetype: 'burn', players: 3, topCut: 0 }]);
  });

  it('counts each swiss match from both sides', () => {
    const log = withDecks(swissHistory([P1, P2], [[[P1, P2, played(2, 1)]]]), [
      [P1, 'Burn'],
      [P2, 'Elves'],
    ]);
    expect(metagameOf(log).matchups).toEqual([
      {
        archetype: 'Burn',
        opponent: 'Elves',
        wins: 1,
        losses: 0,
        draws: 0,
        games: { won: 2, lost: 1, drawn: 0 },
      },
      {
        archetype: 'Elves',
        opponent: 'Burn',
        wins: 0,
        losses: 1,
        draws: 0,
        games: { won: 1, lost: 2, drawn: 0 },
      },
    ]);
  });

  it('adds both sides of a mirror to one pair', () => {
    const log = withDecks(swissHistory([P1, P2], [[[P1, P2, played(2, 0)]]]), [
      [P1, 'Burn'],
      [P2, 'burn'],
    ]);
    expect(metagameOf(log).matchups).toEqual([
      {
        archetype: 'Burn',
        opponent: 'Burn',
        wins: 1,
        losses: 1,
        draws: 0,
        games: { won: 2, lost: 2, drawn: 0 },
      },
    ]);
  });

  it('counts matches against and between players without an archetype', () => {
    const log = withDecks(
      swissHistory(
        [P1, P2, P3, P4],
        [
          [
            [P1, P2, played(2, 1)],
            [P3, P4, played(1, 1, 1)],
          ],
        ],
      ),
      [[P1, 'Burn']],
    );
    expect(metagameOf(log).matchups).toEqual([
      expect.objectContaining({ archetype: 'Burn', opponent: null, wins: 1 }),
      expect.objectContaining({ archetype: null, opponent: 'Burn', losses: 1 }),
      expect.objectContaining({
        archetype: null,
        opponent: null,
        draws: 2,
        games: { won: 2, lost: 2, drawn: 2 },
      }),
    ]);
  });

  it('ignores byes, unplayed and unreported matches, and counts intentional draws without games', () => {
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
    ).add('RoundPaired', {
      round: 3,
      stage: 'swiss',
      pairings: [pairing(9, 1, P2, P3), pairing(10, 2, P1, null)],
    });
    withDecks(log, [
      [P1, 'Burn'],
      [P2, 'Elves'],
      [P3, 'Tron'],
    ]);

    expect(metagameOf(log).matchups).toEqual([
      {
        archetype: 'Burn',
        opponent: 'Tron',
        wins: 0,
        losses: 0,
        draws: 1,
        games: { won: 0, lost: 0, drawn: 0 },
      },
      {
        archetype: 'Tron',
        opponent: 'Burn',
        wins: 0,
        losses: 0,
        draws: 1,
        games: { won: 0, lost: 0, drawn: 0 },
      },
    ]);
  });

  it('gives null archetypes only for the SPEC 02 fixture, and counts its top cut players', () => {
    const doc = fixture as TournamentDocument;
    const { archetypes, matchups } = tournamentMetagame(reduce(doc.events, doc.id));
    expect(archetypes).toEqual([{ archetype: null, players: 8, topCut: 4 }]);
    expect(matchups.every((m) => m.archetype === null && m.opponent === null)).toBe(true);
  });

  it('counts players in a top cut match per archetype, and top cut matches as matchups', () => {
    const doc = fixture as TournamentDocument;
    const decks = [P1, P2, P3, P4, P5, P6, P7, P8].map((playerId, i) =>
      event(doc.events.length + i + 1, 'DeckSet', {
        playerId,
        archetype: i % 2 === 0 ? 'Burn' : 'Elves',
        main: [],
        sideboard: [],
      }),
    );
    const state = reduce([...doc.events, ...decks], doc.id);
    const topCutPlayers = new Set(
      state.rounds
        .filter((round) => round.stage === 'topCut')
        .flatMap((round) => round.matches.flatMap((m) => [m.playerA, m.playerB])),
    );
    const burnInTopCut = [P1, P3, P5, P7].filter((p) => topCutPlayers.has(p)).length;

    const { archetypes, matchups } = tournamentMetagame(state);
    expect(archetypes).toEqual([
      { archetype: 'Burn', players: 4, topCut: burnInTopCut },
      { archetype: 'Elves', players: 4, topCut: 4 - burnInTopCut },
    ]);
    const played = state.rounds.flatMap((round) =>
      round.matches.filter(
        (m) => m.playerB !== null && m.result !== null && m.result.kind !== 'unplayed',
      ),
    );
    const counted = matchups.reduce((sum, m) => sum + m.wins + m.losses + m.draws, 0);
    expect(counted).toBe(2 * played.length);
  });
});
