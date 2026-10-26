import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type Format, type IsoDate, type TournamentMetagame } from '../domain';
import { uuid } from '../domain/fixtures/builders';
import type { StorageBackend, TournamentSummary } from '../storage';
import { MetagamePage } from './MetagamePage';

const mocks = vi.hoisted(() => ({
  listTournaments: vi.fn(),
  loadTournament: vi.fn(),
}));

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>();
  return {
    ...actual,
    getStorage: () =>
      ({
        listTournaments: mocks.listTournaments,
        loadTournament: mocks.loadTournament,
      }) as unknown as StorageBackend,
  };
});

let idCount = 0;

/** A summary with only the fields the metagame page reads filled in. */
function summary(
  date: IsoDate,
  format: Format,
  archetypes: [string | null, number][],
): TournamentSummary {
  const metagame: TournamentMetagame = {
    archetypes: archetypes.map(([archetype, players]) => ({ archetype, players, topCut: 0 })),
    matchups: [],
  };
  return {
    id: uuid(++idCount),
    name: `Tournament ${idCount}`,
    date,
    format,
    status: 'finished',
    eventCount: 1,
    playerCount: archetypes.reduce((sum, [, players]) => sum + players, 0),
    updatedAt: `${date}T20:00:00.000Z`,
    revision: '1',
    players: [],
    archetypes: archetypes.flatMap(([archetype]) => (archetype === null ? [] : [archetype])),
    metagame,
  };
}

// Date-descending, as `listTournaments` returns them.
const TOURNAMENTS = [
  summary('2026-03-01', 'pioneer', [[null, 6]]),
  summary('2026-02-15', 'legacy', [
    ['Elves', 2],
    ['Delver', 1],
  ]),
  summary('2026-02-01', 'modern', [
    ['Burn', 3],
    [null, 1],
  ]),
  summary('2026-01-01', 'modern', [
    ['Tron', 2],
    ['Burn', 2],
  ]),
  summary('2025-12-01', 'modern', [[null, 8]]),
];

/** Renders the router location, so tests can read the query. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{`${pathname}${search}`}</output>;
}

const location = () => screen.getByTestId('location').textContent;

async function renderPage(path = '/metagame') {
  render(
    <MantineProvider env="test">
      <MemoryRouter initialEntries={[path]}>
        <MetagamePage />
        <LocationProbe />
      </MemoryRouter>
    </MantineProvider>,
  );
  await act(async () => {});
}

const table = () => within(screen.getByRole('table', { name: 'Archetypes' }));
const names = () =>
  table()
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent);
const formatInput = () => screen.getByRole('combobox', { name: 'Format' });

beforeEach(() => {
  mocks.listTournaments.mockReset().mockResolvedValue(ok(TOURNAMENTS));
  mocks.loadTournament.mockReset();
});

describe('MetagamePage', () => {
  it('defaults to the format of the latest tournament with decks', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Metagame', level: 1 })).toBeInTheDocument();
    expect(formatInput()).toHaveValue('Legacy');
    expect(names()).toEqual(['Elves', 'Delver']);
    expect(screen.getByText('1 tournament · 3 players')).toBeInTheDocument();
    expect(location()).toBe('/metagame');
    expect(mocks.loadTournament).not.toHaveBeenCalled();
  });

  it('reads the filters from the query and shows the skipped note', async () => {
    await renderPage('/metagame?format=modern&from=2025-11-01&to=2026-01-31');
    expect(formatInput()).toHaveValue('Modern');
    expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue('2025-11-01');
    expect(screen.getByRole('textbox', { name: 'To' })).toHaveValue('2026-01-31');
    expect(names()).toEqual(['Burn', 'Tron']);
    expect(screen.getByText('1 tournament · 4 players')).toBeInTheDocument();
    expect(screen.getByText('1 tournament without decks is not counted.')).toBeInTheDocument();
  });

  it('counts every tournament in the format without dates, Unknown last', async () => {
    await renderPage('/metagame?format=modern');
    expect(names()).toEqual(['Burn', 'Tron', 'Unknown']);
    expect(screen.getByText('2 tournaments · 8 players')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Matchups', level: 2 })).toBeInTheDocument();
  });

  it('ignores invalid query values', async () => {
    await renderPage('/metagame?format=brawl&from=yesterday&to=2026-13-40');
    expect(formatInput()).toHaveValue('Legacy');
    expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'To' })).toHaveValue('');
    expect(names()).toEqual(['Elves', 'Delver']);
  });

  it('writes a changed format into the query', async () => {
    await renderPage();
    fireEvent.click(formatInput());
    fireEvent.click(await screen.findByRole('option', { name: 'Modern' }));
    expect(location()).toBe('/metagame?format=modern');
    expect(names()).toEqual(['Burn', 'Tron', 'Unknown']);
  });

  it('writes a changed date into the query, with the current format', async () => {
    await renderPage();
    const fromInput = screen.getByRole('textbox', { name: 'From' });
    fireEvent.change(fromInput, { target: { value: '2026-02-20' } });
    fireEvent.blur(fromInput);
    expect(location()).toBe('/metagame?format=legacy&from=2026-02-20');
    expect(screen.getByText('No decks recorded for Legacy in this range.')).toBeInTheDocument();
    expect(formatInput()).toBeInTheDocument();
  });

  it('shows the range empty state when from is after to', async () => {
    await renderPage('/metagame?format=modern&from=2026-02-01&to=2026-01-01');
    expect(screen.getByText('No decks recorded for Modern in this range.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the no-decks state without filters when no tournament has a deck', async () => {
    mocks.listTournaments.mockResolvedValue(ok([TOURNAMENTS[0], TOURNAMENTS[4]]));
    await renderPage('/metagame?format=modern');
    expect(
      screen.getByText("No decks recorded yet. Set decks from a tournament's registration list."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Format' })).not.toBeInTheDocument();
  });

  it('shows a load error', async () => {
    mocks.listTournaments.mockResolvedValue(err({ code: 'INVALID_DOCUMENT', message: 'bad' }));
    await renderPage();
    expect(
      screen.getByText('Could not load tournaments (INVALID_DOCUMENT): bad'),
    ).toBeInTheDocument();
  });
});
