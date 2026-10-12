import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TournamentDocument } from '../domain';
import fixture from '../domain/fixtures/top4-8players.json';
import {
  DexieBackend,
  downloadJson,
  type PersistenceStatus,
  type StorageBackend,
} from '../storage';
import { DataPage } from './DataPage';

const mocks = vi.hoisted(() => ({
  backend: null as StorageBackend | null,
  persistence: 'granted' as PersistenceStatus,
}));

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>();
  return {
    ...actual,
    getStorage: () => mocks.backend!,
    getPersistence: () => Promise.resolve(mocks.persistence),
    downloadJson: vi.fn(),
  };
});

let dbCount = 0;

function freshBackend() {
  dbCount += 1;
  return new DexieBackend({ dbName: `test-data-page-${dbCount}` });
}

function fixtureDoc(): TournamentDocument {
  return structuredClone(fixture) as TournamentDocument;
}

function renderPage() {
  render(
    <MantineProvider>
      <DataPage />
    </MantineProvider>,
  );
}

beforeEach(() => {
  mocks.backend = freshBackend();
  mocks.persistence = 'granted';
  vi.mocked(downloadJson).mockClear();
});

describe('DataPage', () => {
  it('shows the empty state', async () => {
    renderPage();
    expect(await screen.findByText('No tournaments stored yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export all' })).toBeEnabled();
  });

  it('lists a stored tournament', async () => {
    await mocks.backend!.saveTournament(fixtureDoc(), null);
    renderPage();

    const row = (await screen.findByText('Friday Night Magic')).closest('tr')!;
    const cells = within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells).toEqual([
      'Friday Night Magic',
      '2026-10-11',
      'Modern',
      'Finished',
      String(fixture.events.length),
      'Export',
    ]);
  });

  it('exports one tournament with its file name', async () => {
    await mocks.backend!.saveTournament(fixtureDoc(), null);
    renderPage();

    const row = (await screen.findByText('Friday Night Magic')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1));
    expect(downloadJson).toHaveBeenCalledWith(
      'modotorneo-friday-night-magic-2026-10-11.json',
      fixture,
    );
  });

  it('exports the full dataset with its file name', async () => {
    await mocks.backend!.saveTournament(fixtureDoc(), null);
    renderPage();
    await screen.findByText('Friday Night Magic');

    fireEvent.click(screen.getByRole('button', { name: 'Export all' }));

    await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1));
    const [fileName, dataset] = vi.mocked(downloadJson).mock.calls[0];
    expect(fileName).toMatch(/^modotorneo-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(dataset).toMatchObject({ kind: 'modotorneo-dataset', tournaments: [fixture] });
  });

  it('shows the persistence status', async () => {
    mocks.persistence = 'notGranted';
    renderPage();
    expect(
      await screen.findByText('Persistent storage: not granted. Export backups regularly.'),
    ).toBeInTheDocument();
  });

  it('shows an alert and disables export when storage is unavailable', async () => {
    mocks.backend = {
      ...freshBackend(),
      listTournaments: () =>
        Promise.resolve({ ok: false, error: { code: 'UNAVAILABLE', message: 'blocked' } }),
    } as unknown as StorageBackend;
    renderPage();

    expect(
      await screen.findByText('Local storage is unavailable in this browser.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled();
  });
});
