import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { HashRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREATED_PAYLOAD,
  PLAYERS,
  TOURNAMENT_ID,
  swissHistory,
  uuid,
} from '../domain/fixtures/builders';
import { DexieBackend, type StorageBackend } from '../storage';
import { PlayersPage } from './PlayersPage';

const mocks = vi.hoisted(() => {
  const current = { backend: null as unknown };
  // The players store takes its backend at import time; this one forwards to `current.backend`.
  const forwarding = new Proxy(
    {},
    {
      get:
        (_, key) =>
        (...args: unknown[]) =>
          (current.backend as Record<PropertyKey, (...a: unknown[]) => unknown>)[key](...args),
    },
  );
  return { current, forwarding };
});

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>();
  return { ...actual, getStorage: () => mocks.forwarding };
});

const [P1, P2, P3, P4] = PLAYERS;
const P5 = uuid(205);
const NOW = '2026-10-11T18:00:00.000Z';

let dbCount = 0;
let backend: StorageBackend;

beforeEach(() => {
  dbCount += 1;
  backend = new DexieBackend({ dbName: `test-players-page-${dbCount}` });
  mocks.current.backend = backend;
});

/**
 * Registry: Alice (P1), Bruno (P2), Carmen (P3) and Diego (P5, no tournaments). P4 plays but is
 * not in the registry. Alice 1-1-0 (games 2-3), Bruno 1-1-0 (3-3), Carmen 2-0-0 (4-1).
 */
async function seed() {
  for (const [id, name] of [
    [P1, 'Alice'],
    [P2, 'Bruno'],
    [P3, 'Carmen'],
    [P5, 'Diego'],
  ]) {
    await backend.savePlayer({ id, name, createdAt: NOW });
  }
  const log = swissHistory(
    [P1, P2, P3, P4],
    [
      [
        [P1, P2],
        [P3, P4],
      ],
      [
        [P1, P3, { winsA: 0, winsB: 2, draws: 0, kind: 'played' }],
        [P2, P4],
      ],
    ],
    { ...CREATED_PAYLOAD, swissRounds: 2 },
  );
  await backend.saveTournament({ schemaVersion: 1, id: TOURNAMENT_ID, events: log.events }, null);
}

function renderPage() {
  render(
    <MantineProvider env="test">
      <HashRouter>
        <PlayersPage />
      </HashRouter>
    </MantineProvider>,
  );
}

const table = () => within(screen.getByRole('table', { name: 'Players' }));
const names = () =>
  table()
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent);
const sortBy = (column: string) => fireEvent.click(table().getByRole('button', { name: column }));
const header = (column: string) => table().getByRole('columnheader', { name: column });

describe('PlayersPage', () => {
  it('lists registry players with their totals, and zeros and "—" without tournaments', async () => {
    await seed();
    renderPage();

    const alice = await screen.findByRole('link', { name: 'Alice' });
    expect(alice).toHaveAttribute('href', `#/players/${P1}`);
    const cells = (name: string) =>
      within(table().getByRole('link', { name }).closest('tr')!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells('Alice')).toEqual(['Alice', '1', '1-1-0', '50.00%', '40.00%', '2026-10-11']);
    expect(cells('Carmen')).toEqual(['Carmen', '1', '2-0-0', '100.00%', '80.00%', '2026-10-11']);
    expect(cells('Diego')).toEqual(['Diego', '0', '0-0-0', '—', '—', '—']);
    expect(names()).toEqual(['Alice', 'Bruno', 'Carmen', 'Diego']);
  });

  it('filters by a case-insensitive part of the name', async () => {
    await seed();
    renderPage();
    await screen.findByRole('link', { name: 'Alice' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'R' } });
    expect(names()).toEqual(['Bruno', 'Carmen']);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'zz' } });
    expect(screen.getByText('No player matches the search.')).toBeInTheDocument();
  });

  it('sorts by each column, flips on a second click and keeps null values last', async () => {
    await seed();
    renderPage();
    await screen.findByRole('link', { name: 'Alice' });
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');

    sortBy('Name');
    expect(names()).toEqual(['Diego', 'Carmen', 'Bruno', 'Alice']);
    expect(header('Name')).toHaveAttribute('aria-sort', 'descending');

    sortBy('Match win %');
    expect(names()).toEqual(['Carmen', 'Alice', 'Bruno', 'Diego']);
    expect(header('Match win %')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Name')).toHaveAttribute('aria-sort', 'none');
    sortBy('Match win %');
    expect(names()).toEqual(['Alice', 'Bruno', 'Carmen', 'Diego']);
    expect(header('Match win %')).toHaveAttribute('aria-sort', 'ascending');

    sortBy('Game win %');
    expect(names()).toEqual(['Carmen', 'Bruno', 'Alice', 'Diego']);
    sortBy('Game win %');
    expect(names()).toEqual(['Alice', 'Bruno', 'Carmen', 'Diego']);

    sortBy('Tournaments');
    expect(names()).toEqual(['Alice', 'Bruno', 'Carmen', 'Diego']);
    sortBy('Tournaments');
    expect(names()).toEqual(['Diego', 'Alice', 'Bruno', 'Carmen']);

    sortBy('Record');
    expect(names()).toEqual(['Carmen', 'Alice', 'Bruno', 'Diego']);
    sortBy('Record');
    expect(names()).toEqual(['Diego', 'Alice', 'Bruno', 'Carmen']);

    sortBy('Last played');
    expect(names()).toEqual(['Alice', 'Bruno', 'Carmen', 'Diego']);
    sortBy('Last played');
    expect(names()).toEqual(['Alice', 'Bruno', 'Carmen', 'Diego']);
    expect(header('Last played')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('shows the empty message without registry players', async () => {
    renderPage();
    expect(
      await screen.findByText(
        'No players yet. Players are added when you register them in a tournament.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the storage alert when the list fails', async () => {
    await seed();
    backend.listTournaments = async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'blocked' },
    });
    renderPage();
    expect(
      await screen.findByText('Local storage is unavailable in this browser.'),
    ).toBeInTheDocument();
  });
});
