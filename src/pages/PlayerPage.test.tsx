import { MantineProvider } from '@mantine/core';
import { render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TournamentDocument } from '../domain';
import { CREATED_PAYLOAD, PLAYERS, swissHistory, uuid } from '../domain/fixtures/builders';
import fixture from '../domain/fixtures/top4-8players.json';
import { DexieBackend, type StorageBackend } from '../storage';
import { PlayerPage } from './PlayerPage';

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

const [P1, P2, P3] = PLAYERS;
const NEWCOMER = uuid(205);
const PAUPER_ID = uuid(600);
const NOW = '2026-10-11T18:00:00.000Z';

let dbCount = 0;
let backend: StorageBackend;

beforeEach(() => {
  dbCount += 1;
  backend = new DexieBackend({ dbName: `test-player-page-${dbCount}` });
  mocks.current.backend = backend;
});

/**
 * Alice (P1) plays the SPEC 02 fixture (3-0-0 swiss, 1-1 top cut, 2nd) and a pauper event:
 * a 1-2 loss, a bye, then a drop. Newcomer is in the registry with no tournaments.
 */
async function seed() {
  await backend.savePlayer({ id: P1, name: 'Alice', createdAt: NOW });
  await backend.savePlayer({ id: NEWCOMER, name: 'Newcomer', createdAt: NOW });
  await backend.saveTournament(structuredClone(fixture) as TournamentDocument, null);
  const pauper = swissHistory(
    [P1, P2, P3],
    [
      [
        [P1, P2, { winsA: 1, winsB: 2, draws: 0, kind: 'played' }],
        [P3, null],
      ],
      [
        [P2, P3],
        [P1, null],
      ],
    ],
    { ...CREATED_PAYLOAD, name: 'Pauper Night', date: '2026-10-20', format: 'pauper' },
  ).add('PlayerDropped', { playerId: P1 });
  await backend.saveTournament({ schemaVersion: 1, id: PAUPER_ID, events: pauper.events }, null);
}

function renderPage(id: string) {
  const router = createMemoryRouter([{ path: '/players/:id', element: <PlayerPage /> }], {
    initialEntries: [`/players/${id}`],
  });
  render(
    <MantineProvider env="test">
      <RouterProvider router={router} />
    </MantineProvider>,
  );
}

const rowsOf = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );

const totalOf = (label: string) =>
  within(screen.getByRole('rowheader', { name: label }).closest('tr')!).getByRole('cell')
    .textContent;

describe('PlayerPage', () => {
  it('shows totals, the per-format table and the history', async () => {
    await seed();
    renderPage(P1);

    expect(await screen.findByRole('heading', { name: 'Alice', level: 1 })).toBeInTheDocument();
    expect(totalOf('Tournaments')).toBe('2');
    expect(totalOf('Record')).toBe('4-2-0');
    expect(totalOf('Match win %')).toBe('66.67%');
    expect(totalOf('Game win %')).toBe('58.82%');
    expect(totalOf('Byes')).toBe('1');
    expect(totalOf('Top cuts')).toBe('1');
    expect(totalOf('Best top cut finish')).toBe('2nd');

    expect(rowsOf('By format')).toEqual([
      ['Modern', '1', '4-1-0', '80.00%', '64.29%'],
      ['Pauper', '1', '0-1-0', '0.00%', '33.33%'],
    ]);
    expect(rowsOf('Tournament history')).toEqual([
      ['2026-10-20', 'Pauper NightDropped', 'Pauper', 'Running', '0-1-0 +1 bye', '2 of 3', '—'],
      ['2026-10-11', 'Friday Night Magic', 'Modern', 'Finished', '3-0-0', '1 of 8', '2nd'],
    ]);
  });

  it('links history rows to the tournament', async () => {
    await seed();
    renderPage(P1);

    expect(await screen.findByRole('link', { name: 'Pauper Night' })).toHaveAttribute(
      'href',
      `/tournaments/${PAUPER_ID}`,
    );
    expect(screen.getByRole('link', { name: 'Friday Night Magic' })).toHaveAttribute(
      'href',
      `/tournaments/${fixture.id}`,
    );
  });

  it('shows "Player not found" for an id outside the registry', async () => {
    await seed();
    // P2 played the pauper event but is not in the registry.
    renderPage(P2);

    expect(await screen.findByText('Player not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Players' })).toHaveAttribute('href', '/players');
  });

  it('shows the empty message and no per-format table without tournaments', async () => {
    await seed();
    renderPage(NEWCOMER);

    expect(
      await screen.findByText('Newcomer has not played in any tournament yet.'),
    ).toBeInTheDocument();
    expect(totalOf('Tournaments')).toBe('0');
    expect(totalOf('Match win %')).toBe('—');
    expect(totalOf('Best top cut finish')).toBe('—');
    expect(screen.queryByRole('table', { name: 'By format' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Tournament history' })).not.toBeInTheDocument();
  });
});
