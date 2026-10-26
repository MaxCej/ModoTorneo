import { describe, expect, it } from 'vitest';
import {
  PLAYERS,
  TOURNAMENT_ID,
  event,
  pairing,
  registeredLog,
  swissHistory,
  uuid,
  type LogBuilder,
} from './fixtures/builders';
import fixture from './fixtures/top4-8players.json';
import {
  defaultMetagameFormat,
  metagameReport,
  tournamentMetagame,
  type MetagameFilters,
  type MetagameReport,
  type MetagameSource,
} from './metagame';
import { reduce } from './reduce';
import type { Format } from './schemas/common';
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

type MatchupParts = [
  string | null,
  string | null,
  number,
  number,
  number,
  [number, number, number]?,
];

/** A source with `entries` as [archetype, players, topCut?] and one row per matchup side. */
function source(
  id: number,
  date: string,
  entries: [string | null, number, number?][],
  matchups: MatchupParts[] = [],
  format: Format = 'modern',
): MetagameSource {
  return {
    id: uuid(id),
    date,
    format,
    metagame: {
      archetypes: entries.map(([archetype, players, topCut]) => ({
        archetype,
        players,
        topCut: topCut ?? 0,
      })),
      matchups: matchups.map(([archetype, opponent, wins, losses, draws, games]) => ({
        archetype,
        opponent,
        wins,
        losses,
        draws,
        games: games
          ? { won: games[0], lost: games[1], drawn: games[2] }
          : { won: 0, lost: 0, drawn: 0 },
      })),
    },
  };
}

/** Both sides of `wins`-`losses`-`draws` matches between `a` and `b`. */
function both(
  a: string | null,
  b: string | null,
  wins: number,
  losses: number,
  draws = 0,
): MatchupParts[] {
  return [
    [a, b, wins, losses, draws],
    [b, a, losses, wins, draws],
  ];
}

const MODERN: MetagameFilters = { format: 'modern', from: null, to: null };
const labels = (report: MetagameReport) => report.archetypes.map((a) => a.archetype);
const groupLabels = (report: MetagameReport) =>
  report.groups.map((g) => (g.kind === 'archetype' ? g.stats.archetype : g.kind));

describe('metagameReport', () => {
  const tournaments = [
    source(1, '2026-03-01', [['Burn', 2]]),
    source(2, '2026-02-01', [['Elves', 1]], [], 'legacy'),
    source(3, '2026-01-15', [['Tron', 1]]),
    source(4, '2026-01-01', [['Affinity', 1]]),
  ];

  it('counts only the format, with both date bounds inclusive and optional', () => {
    expect(labels(metagameReport(tournaments, MODERN))).toEqual(['Burn', 'Affinity', 'Tron']);
    expect(
      labels(metagameReport(tournaments, { ...MODERN, from: '2026-01-15', to: '2026-03-01' })),
    ).toEqual(['Burn', 'Tron']);
    expect(labels(metagameReport(tournaments, { ...MODERN, to: '2026-01-15' }))).toEqual([
      'Affinity',
      'Tron',
    ]);
    expect(labels(metagameReport(tournaments, { ...MODERN, from: '2026-01-02' }))).toEqual([
      'Burn',
      'Tron',
    ]);
    expect(labels(metagameReport(tournaments, { ...MODERN, format: 'legacy' }))).toEqual(['Elves']);
  });

  it('counts nothing when from is after to', () => {
    const report = metagameReport(tournaments, {
      ...MODERN,
      from: '2026-03-01',
      to: '2026-01-01',
    });
    expect(report).toMatchObject({ tournaments: 0, skipped: 0, players: 0, archetypes: [] });
    expect(report.groups).toEqual([]);
    expect(report.matrix).toEqual([]);
  });

  it('skips tournaments where no player has an archetype', () => {
    const report = metagameReport(
      [
        source(1, '2026-03-01', [
          ['Burn', 1],
          [null, 3],
        ]),
        source(2, '2026-02-01', [[null, 8]]),
        source(3, '2026-01-01', []),
      ],
      MODERN,
    );
    expect(report).toMatchObject({ tournaments: 1, skipped: 2, players: 4 });
    expect(report.archetypes.map((a) => [a.archetype, a.players, a.share])).toEqual([
      ['Burn', 1, 0.25],
      [null, 3, 0.75],
    ]);
  });

  it('groups labels case-insensitively with the most recent spelling', () => {
    const report = metagameReport(
      [
        source(1, '2026-03-01', [['Izzet Prowess', 1]]),
        source(
          2,
          '2026-02-01',
          [
            ['izzet prowess', 2, 1],
            ['Burn', 1],
          ],
          both('izzet prowess', 'Burn', 1, 0),
        ),
      ],
      MODERN,
    );
    expect(report.archetypes.map((a) => [a.archetype, a.players, a.topCut])).toEqual([
      ['Izzet Prowess', 3, 1],
      ['Burn', 1, 0],
    ]);
    expect(report.archetypes[0].matches).toEqual({ wins: 1, losses: 0, draws: 0 });
  });

  it('excludes mirrors from records and rates, and gives null rates without matches', () => {
    const report = metagameReport(
      [
        source(
          1,
          '2026-01-01',
          [
            ['Burn', 3],
            ['Elves', 1],
            ['Tron', 1],
          ],
          [
            ['Burn', 'Burn', 1, 1, 0, [3, 3, 0]],
            ['Burn', 'Elves', 2, 1, 1, [5, 3, 1]],
            ['Elves', 'Burn', 1, 2, 1, [3, 5, 1]],
          ],
        ),
      ],
      MODERN,
    );
    const [burn, elves, tron] = report.archetypes;
    expect(burn).toEqual({
      archetype: 'Burn',
      players: 3,
      share: 0.6,
      matches: { wins: 2, losses: 1, draws: 1 },
      games: { won: 5, lost: 3, drawn: 1 },
      matchWinRate: 0.5,
      gameWinRate: 5 / 9,
      topCut: 0,
    });
    expect(elves.matchWinRate).toBe(0.25);
    expect(tron).toMatchObject({ archetype: 'Tron', matchWinRate: null, gameWinRate: null });
  });

  it('gives a null game win rate with intentional draws only', () => {
    const report = metagameReport(
      [
        source(
          1,
          '2026-01-01',
          [
            ['Burn', 1],
            ['Elves', 1],
          ],
          both('Burn', 'Elves', 0, 0, 1),
        ),
      ],
      MODERN,
    );
    expect(report.archetypes[0]).toMatchObject({ matchWinRate: 0, gameWinRate: null });
  });

  /** Nine archetypes (A9 the least played, A7a and A7b tied) and two Unknown players. */
  const nine = () =>
    source(
      1,
      '2026-01-01',
      [
        ['A9', 1],
        ['A1', 9],
        ['A2', 8],
        ['A3', 7],
        ['A4', 6],
        ['A5', 5],
        ['A6', 4],
        ['A7b', 3],
        ['A7a', 3],
        [null, 2],
      ],
      [
        ...both('A7b', 'A9', 2, 1),
        ['A9', 'A9', 1, 1, 0],
        ...both('A1', 'A7b', 1, 0),
        ...both(null, 'A9', 0, 1),
      ],
    );

  it('gives 8 archetype groups, then Other, then Unknown, ties by name', () => {
    const report = metagameReport([nine()], MODERN);
    expect(groupLabels(report)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'A6',
      'A7a',
      'A7b',
      'other',
      'unknown',
    ]);
    expect(labels(report)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7a', 'A7b', 'A9', null]);
    expect(report.groups[8]).toMatchObject({ kind: 'other', members: 1 });
  });

  it('gives no Other group with 8 archetypes, and no Unknown group without unknown players', () => {
    const report = metagameReport(
      [
        source(
          1,
          '2026-01-01',
          [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`A${n}`, 1]),
        ),
      ],
      MODERN,
    );
    expect(report.groups).toHaveLength(8);
    expect(report.groups.every((g) => g.kind === 'archetype')).toBe(true);
  });

  it('counts matches between different Other members, but not member mirrors', () => {
    const report = metagameReport(
      [
        source(
          1,
          '2026-01-01',
          [
            ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): [string, number] => [`A${n}`, 10]),
            ['X', 1],
            ['Y', 1],
          ],
          [...both('X', 'Y', 1, 0), ['X', 'X', 1, 1, 0], ...both('X', 'A1', 0, 1)],
        ),
      ],
      MODERN,
    );
    const other = report.groups[8];
    expect(other).toMatchObject({ kind: 'other', members: 2 });
    expect(other.stats).toMatchObject({
      archetype: null,
      players: 2,
      matches: { wins: 1, losses: 2, draws: 0 },
    });
    // One X-Y match and one X mirror: 2 matches inside Other.
    expect(report.matrix[8][8]).toEqual({ kind: 'mirror', matches: 2 });
  });

  it('fills cells from the row side, mirror counts on the diagonal, none when never met', () => {
    const report = metagameReport([nine()], MODERN);
    const [a1, a2, a7b, other, unknown] = [0, 1, 7, 8, 9];
    expect(report.matrix[a1][a7b]).toEqual({
      kind: 'matchup',
      winRate: 1,
      wins: 1,
      losses: 0,
      draws: 0,
    });
    expect(report.matrix[a7b][a1]).toEqual({
      kind: 'matchup',
      winRate: 0,
      wins: 0,
      losses: 1,
      draws: 0,
    });
    expect(report.matrix[other][a7b]).toEqual({
      kind: 'matchup',
      winRate: 1 / 3,
      wins: 1,
      losses: 2,
      draws: 0,
    });
    expect(report.matrix[other][other]).toEqual({ kind: 'mirror', matches: 1 });
    expect(report.matrix[unknown][other]).toMatchObject({ kind: 'matchup', winRate: 0 });
    expect(report.matrix[a1][a1]).toEqual({ kind: 'none' });
    expect(report.matrix[a1][a2]).toEqual({ kind: 'none' });
    expect(report.matrix).toHaveLength(10);
    expect(report.matrix.every((row) => row.length === 10)).toBe(true);
  });
});

describe('defaultMetagameFormat', () => {
  it('gives the format of the most recent tournament with an archetype', () => {
    expect(
      defaultMetagameFormat([
        source(1, '2026-03-01', [[null, 4]], [], 'pioneer'),
        source(2, '2026-02-01', [['Elves', 1]], [], 'legacy'),
        source(3, '2026-01-01', [['Burn', 1]], [], 'modern'),
      ]),
    ).toBe('legacy');
  });

  it('gives null without any archetype', () => {
    expect(defaultMetagameFormat([source(1, '2026-03-01', [[null, 4]])])).toBeNull();
    expect(defaultMetagameFormat([])).toBeNull();
  });
});
