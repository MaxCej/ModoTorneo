import { expect, test, type Page } from '@playwright/test';

// The e2e project resolves modules as Node does, so it cannot import the domain fixture
// builders (extensionless imports). The same shapes are built here, like `builders.ts` does.

/** Deterministic UUID: `uuid(1)` → `00000000-0000-4000-8000-000000000001`. */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const [P1, P2, P3, P4] = [1, 2, 3, 4].map((n) => uuid(100 + n));

type Result = { winsA: number; winsB: number; draws: number; kind: 'played' };
const WIN_21: Result = { winsA: 2, winsB: 1, draws: 0, kind: 'played' };
const WIN_20: Result = { winsA: 2, winsB: 0, draws: 0, kind: 'played' };
const LOSS_02: Result = { winsA: 0, winsB: 2, draws: 0, kind: 'played' };

/** `[playerA, playerB, result (default 2-1 for A)]`. */
type HistoryMatch = [string, string, Result?];

/** A tournament document: four players, closed swiss rounds, then a deck per entry of `decks`. */
function tournament(
  id: number,
  name: string,
  date: string,
  format: 'modern' | 'legacy',
  rounds: HistoryMatch[][],
  decks: [string, string][],
) {
  const events: unknown[] = [];
  const add = (type: string, payload: unknown) => {
    const seq = events.length + 1;
    events.push({
      id: uuid(id * 1000 + seq),
      seq,
      at: new Date(Date.UTC(2026, 0, 1, 18, 0, seq)).toISOString(),
      type,
      payload,
    });
  };
  add('TournamentCreated', {
    name,
    date,
    location: 'Local store',
    format,
    swissRounds: rounds.length,
  });
  for (const [i, playerId] of [P1, P2, P3, P4].entries()) {
    add('PlayerRegistered', { playerId, playerName: `Player ${i + 1}` });
  }
  let match = 0;
  for (const [index, matches] of rounds.entries()) {
    const round = index + 1;
    const pairings = matches.map(([playerA, playerB], i) => ({
      matchId: uuid(id * 1000 + 500 + ++match),
      table: i + 1,
      playerA,
      playerB,
    }));
    add('RoundPaired', { round, stage: 'swiss', pairings });
    for (const [i, [, , result]] of matches.entries()) {
      add('ResultReported', { matchId: pairings[i].matchId, result: result ?? WIN_21 });
    }
    add('RoundClosed', { round });
  }
  for (const [playerId, archetype] of decks) {
    add('DeckSet', { playerId, archetype, main: [], sideboard: [] });
  }
  return { schemaVersion: 1, id: uuid(9000 + id), events };
}

// Modern, all time: Burn 3 and Tron 3 of 8 players (the no-deck event is skipped).
// Burn goes 2-1 (games 4-3) outside the mirror; Burn against Tron is 1-1.
const DATASET = {
  kind: 'modotorneo-dataset',
  schemaVersion: 1,
  exportedAt: '2026-03-02T12:00:00.000Z',
  players: [],
  tournaments: [
    tournament(
      1,
      'Modern March',
      '2026-03-01',
      'modern',
      [
        [
          [P1, P3],
          [P2, P4, WIN_20],
        ],
        [
          [P1, P2],
          [P3, P4],
        ],
      ],
      [
        [P1, 'Burn'],
        [P2, 'Burn'],
        [P3, 'Tron'],
        [P4, 'Elves'],
      ],
    ),
    tournament(
      2,
      'Legacy February',
      '2026-02-15',
      'legacy',
      [
        [
          [P1, P2, WIN_20],
          [P3, P4],
        ],
      ],
      [
        [P1, 'Delver'],
        [P2, 'Elves'],
      ],
    ),
    tournament(
      3,
      'Modern no decks',
      '2026-02-01',
      'modern',
      [
        [
          [P1, P2],
          [P3, P4],
        ],
      ],
      [],
    ),
    tournament(
      4,
      'Modern January',
      '2026-01-10',
      'modern',
      [
        [
          [P1, P2, LOSS_02],
          [P3, P4, WIN_20],
        ],
      ],
      [
        [P1, 'Burn'],
        [P2, 'Tron'],
        [P3, 'Tron'],
      ],
    ),
  ],
};

async function importDataset(page: Page) {
  await page.goto('./#/data');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'dataset.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(DATASET)),
  });
  // Four tournaments, and the four players they register.
  await expect(page.getByText('Added: 4')).toHaveCount(2);
}

const archetypes = (page: Page) => page.getByRole('table', { name: 'Archetypes' });
const archetypeCells = (page: Page, name: string) =>
  archetypes(page)
    .getByRole('row', { name: new RegExp(`^${name}`) })
    .getByRole('cell');
const matrixCells = (page: Page, name: string) =>
  page
    .getByRole('table', { name: "Row archetype's match win % against the column archetype." })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name, exact: true }) })
    .getByRole('cell');

test('shows the metagame of a format and a date range, kept in the URL', async ({ page }) => {
  await importDataset(page);

  await page.getByRole('navigation').getByRole('link', { name: 'Metagame' }).click();
  await expect(page.getByRole('heading', { name: 'Metagame', level: 1 })).toBeVisible();

  // The most recent tournament with decks is Modern.
  await expect(page.getByRole('combobox', { name: 'Format' })).toHaveValue('Modern');
  await expect(page.getByText('2 tournaments · 8 players')).toBeVisible();
  await expect(page.getByText('1 tournament without decks is not counted.')).toBeVisible();
  await expect(archetypeCells(page, 'Burn')).toHaveText([
    'Burn',
    '3',
    '37.50%',
    '2-1-0',
    '66.67%',
    '57.14%',
    '0',
  ]);
  await expect(archetypes(page).getByRole('row').last()).toContainText('Unknown');
  // Columns: Burn, Tron, Elves, Unknown.
  await expect(matrixCells(page, 'Burn')).toHaveText([
    '1 match',
    '50.00%1-1-0',
    '100.00%1-0-0',
    '—',
  ]);
  await expect(page.getByRole('heading', { name: 'Share', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Match win %', level: 2 })).toBeVisible();

  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: 'Legacy' }).click();
  await expect(page).toHaveURL(/#\/metagame\?format=legacy$/);
  await expect(page.getByText('1 tournament · 4 players')).toBeVisible();
  await expect(archetypes(page).getByRole('row').locator('td:first-child')).toHaveText([
    'Delver',
    'Elves',
    'Unknown',
  ]);

  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: 'Modern' }).click();
  await expect(page).toHaveURL(/#\/metagame\?format=modern$/);
  // The URL changes before the page renders: wait for the Modern view before typing.
  await expect(page.getByText('2 tournaments · 8 players')).toBeVisible();
  const from = page.getByRole('textbox', { name: 'From' });
  await from.fill('2026-02-01');
  await from.blur();
  await expect(page).toHaveURL(/#\/metagame\?format=modern&from=2026-02-01$/);
  await expect(page.getByText('1 tournament · 4 players')).toBeVisible();
  await expect(archetypeCells(page, 'Burn').nth(2)).toHaveText('50.00%');

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Format' })).toHaveValue('Modern');
  await expect(page.getByRole('textbox', { name: 'From' })).toHaveValue('2026-02-01');
  await expect(page.getByText('1 tournament · 4 players')).toBeVisible();
  await expect(page.getByText('1 tournament without decks is not counted.')).toBeVisible();
  await expect(archetypeCells(page, 'Burn').nth(2)).toHaveText('50.00%');
});
