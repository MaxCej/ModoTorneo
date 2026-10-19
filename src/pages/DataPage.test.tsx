import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TournamentDocument } from '../domain';
import fixture from '../domain/fixtures/top4-8players.json';
import {
  DexieBackend,
  downloadJson,
  GitHubBackend,
  writeSettings,
  type PersistenceStatus,
  type StorageBackend,
} from '../storage';
import { FakeGitHub } from '../test/fakeGitHub';
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
  // env="test" turns off transitions and portals, so the modal renders at once.
  return render(
    <MantineProvider env="test">
      <DataPage />
    </MantineProvider>,
  );
}

/** The fixture with one event's `at` changed: same tournament, diverged log. */
function divergedFixture(): TournamentDocument {
  const doc = fixtureDoc();
  doc.events[20] = { ...doc.events[20], at: '2026-10-12T09:00:00.000Z' };
  return doc;
}

function jsonFile(value: unknown, name = 'import.json') {
  return new File([typeof value === 'string' ? value : JSON.stringify(value)], name, {
    type: 'application/json',
  });
}

/** Picks a file through the hidden input of the "Import file" button. */
async function pickFile(container: HTMLElement, file: File) {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import file' })).toBeEnabled());
  const input = container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
}

async function storedEvents(id: string) {
  const loaded = await mocks.backend!.loadTournament(id);
  return loaded.ok ? loaded.value.doc.events : null;
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
      'ExportDelete',
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

describe('DataPage import', () => {
  it('shows the domain error of an invalid file and saves nothing', async () => {
    const { container } = renderPage();
    await pickFile(container, jsonFile('{ not json'));

    const alert = await screen.findByText(/^Invalid file \(INVALID_SCHEMA\):/);
    expect(alert).toBeInTheDocument();
    const list = await mocks.backend!.listTournaments();
    expect(list.ok && list.value).toEqual([]);
  });

  it('imports the fixture and adds its row', async () => {
    const { container } = renderPage();
    await screen.findByText('No tournaments stored yet.');
    await pickFile(container, jsonFile(fixture));

    expect(await screen.findByText('Friday Night Magic')).toBeInTheDocument();
    expect(screen.getByText('Added: 1')).toBeInTheDocument();
    expect(screen.getByText('Players added: 8')).toBeInTheDocument();
  });

  it.each([
    ['Skip', 'Skipped: 1', fixture.events],
    ['Overwrite', 'Overwritten: 1', divergedFixture().events],
    ['Copy', 'Copied: 1', fixture.events],
  ])('resolves a conflict with %s', async (choice, summaryLine, expectedEvents) => {
    await mocks.backend!.saveTournament(fixtureDoc(), null);
    const { container } = renderPage();
    await screen.findByText('Friday Night Magic');
    await pickFile(container, jsonFile(divergedFixture()));

    const dialog = await screen.findByRole('dialog', { name: 'Import conflicts' });
    const group = within(dialog).getByRole('group', { name: 'Friday Night Magic' });
    const count = fixture.events.length;
    expect(
      within(group).getByText(`Stored: ${count} events. Imported: ${count} events.`),
    ).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('radio', { name: choice }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(await screen.findByText(summaryLine)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await storedEvents(fixture.id)).toEqual(expectedEvents);
    if (choice === 'Copy') {
      expect(await screen.findAllByText('Friday Night Magic')).toHaveLength(2);
    }
  });

  it('saves nothing when the import is cancelled', async () => {
    await mocks.backend!.saveTournament(fixtureDoc(), null);
    const { container } = renderPage();
    await screen.findByText('Friday Night Magic');
    await pickFile(container, jsonFile(divergedFixture()));

    const dialog = await screen.findByRole('dialog', { name: 'Import conflicts' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Overwrite' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel import' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Import finished')).not.toBeInTheDocument();
    expect(await storedEvents(fixture.id)).toEqual(fixture.events);
    expect(screen.getByRole('button', { name: 'Import file' })).toBeEnabled();
  });

  it('turns the summary yellow when a save fails', async () => {
    vi.spyOn(mocks.backend!, 'saveTournament').mockResolvedValue({
      ok: false,
      error: { code: 'CONFLICT', message: 'saved in another tab' },
    });
    const { container } = renderPage();
    await pickFile(container, jsonFile(fixture));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Import finished with errors')).toBeInTheDocument();
    expect(
      within(alert).getByText('Could not save Friday Night Magic (CONFLICT): saved in another tab'),
    ).toBeInTheDocument();
    expect(alert.getAttribute('style')).toContain('yellow');
  });

  it('keeps the summary green when every save succeeds', async () => {
    const { container } = renderPage();
    await pickFile(container, jsonFile(fixture));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Import finished')).toBeInTheDocument();
    expect(alert.getAttribute('style')).toContain('green');
  });
});

describe('DataPage delete', () => {
  async function openDeleteModal() {
    await mocks.backend!.saveTournament(fixtureDoc(), null);
    renderPage();
    const row = (await screen.findByText('Friday Night Magic')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete tournament' });
    expect(
      within(dialog).getByText(
        'Delete Friday Night Magic? This cannot be undone. Export it first if unsure.',
      ),
    ).toBeInTheDocument();
    return dialog;
  }

  it('keeps the row on cancel', async () => {
    const dialog = await openDeleteModal();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Friday Night Magic')).toBeInTheDocument();
    expect(await storedEvents(fixture.id)).toEqual(fixture.events);
  });

  it('removes the row on confirm and keeps the players', async () => {
    await mocks.backend!.savePlayer({
      id: '00000000-0000-4000-8000-000000000101',
      name: 'Alice',
      createdAt: '2026-10-11T18:00:02.000Z',
    });
    const dialog = await openDeleteModal();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('No tournaments stored yet.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await storedEvents(fixture.id)).toBeNull();
    const players = await mocks.backend!.listPlayers();
    expect(players.ok && players.value.map((p) => p.name)).toEqual(['Alice']);
  });

  it('explains a conflict and keeps the row when the stored revision changed', async () => {
    const dialog = await openDeleteModal();
    // Another tab saves in between: the row's revision "1" is now stale.
    await mocks.backend!.saveTournament(fixtureDoc(), '1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText(
        'Friday Night Magic was changed in another tab. The list has been refreshed. Delete again if you still want to remove it.',
      ),
    ).toBeInTheDocument();
    expect(await storedEvents(fixture.id)).toEqual(fixture.events);
    expect(screen.getByText('Friday Night Magic')).toBeInTheDocument();
  });
});

describe('DataPage delete errors', () => {
  it('shows the generic error for anything but a conflict', async () => {
    await mocks.backend!.saveTournament(fixtureDoc(), null);
    vi.spyOn(mocks.backend!, 'deleteTournament').mockResolvedValue({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'blocked' },
    });
    renderPage();
    const row = (await screen.findByText('Friday Night Magic')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete tournament' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Delete failed (UNAVAILABLE): blocked')).toBeInTheDocument();
  });

  it('retries a delete after a conflict with the refreshed revision', async () => {
    await mocks.backend!.saveTournament(fixtureDoc(), null);
    renderPage();
    const deleteRow = async () => {
      const row = (await screen.findByText('Friday Night Magic')).closest('tr')!;
      fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete tournament' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    };

    await screen.findByText('Friday Night Magic');
    const list = vi.spyOn(mocks.backend!, 'listTournaments');
    await mocks.backend!.saveTournament(fixtureDoc(), '1'); // another tab
    await deleteRow();
    await screen.findByText(/was changed in another tab/);

    // Wait for the page's reload to finish, so the row carries revision "2".
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await act(async () => {
      await list.mock.results[0].value;
    });

    await deleteRow();
    expect(await screen.findByText('No tournaments stored yet.')).toBeInTheDocument();
  });
});

describe('DataPage storage line', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('shows "Storage: this browser" and the persistence line with local storage', async () => {
    renderPage();
    expect(await screen.findByText('Persistent storage: granted')).toBeInTheDocument();
    expect(screen.getByText('Storage: this browser')).toBeInTheDocument();
  });
});

describe('DataPage with GitHub storage', () => {
  const TOKEN = 'github_pat_data';
  let fake: FakeGitHub;

  beforeEach(() => {
    fake = new FakeGitHub({ token: TOKEN });
    writeSettings({ backend: 'github', owner: fake.owner, repo: fake.repo, token: TOKEN });
    dbCount += 1;
    mocks.backend = new GitHubBackend({
      owner: fake.owner,
      repo: fake.repo,
      token: TOKEN,
      fetch: fake.fetch,
      dbName: `test-data-page-${dbCount}`,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('shows the GitHub status line and hides the persistence line', async () => {
    renderPage();
    expect(await screen.findByText('No tournaments stored yet.')).toBeInTheDocument();
    expect(screen.getByText('Storage: GitHub (alice/mtg-data)')).toBeInTheDocument();
    expect(screen.queryByText(/^Persistent storage/)).not.toBeInTheDocument();
  });

  it('shows the rejected-token alert with a link to Settings', async () => {
    fake.token = 'rotated';
    renderPage();
    expect(
      await screen.findByText('GitHub rejected the token. Check it on the Settings page.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '#/settings',
    );
  });

  it('shows the GitHub text for UNAVAILABLE', async () => {
    fake.rateLimited = true;
    renderPage();
    expect(await screen.findByText(/^Cannot reach GitHub: GitHub rate limit/)).toBeInTheDocument();
  });

  it('imports a dataset file as one file per tournament and players.json', async () => {
    const other = { ...fixtureDoc(), id: '00000000-0000-4000-8000-00000000beef' };
    const players = [
      { id: '00000000-0000-4000-8000-000000000301', name: 'Ana', createdAt: fixture.events[0].at },
      {
        id: '00000000-0000-4000-8000-000000000302',
        name: 'Bóris',
        createdAt: fixture.events[0].at,
      },
    ];
    const dataset = {
      kind: 'modotorneo-dataset',
      schemaVersion: 1,
      exportedAt: '2026-10-12T10:00:00.000Z',
      players,
      tournaments: [fixtureDoc(), other],
    };
    const { container } = renderPage();
    await screen.findByText('No tournaments stored yet.');
    await pickFile(container, jsonFile(dataset));

    expect(await screen.findByText('Added: 2')).toBeInTheDocument();
    expect(fake.paths()).toEqual([
      'players.json',
      `tournaments/${other.id}.json`,
      `tournaments/${fixture.id}.json`,
    ]);
    expect(JSON.parse(fake.getFile(`tournaments/${fixture.id}.json`)!)).toEqual(fixture);
    const stored = JSON.parse(fake.getFile('players.json')!) as {
      players: Array<{ name: string }>;
    };
    expect(stored.players.map((p) => p.name).sort()).toEqual(
      expect.arrayContaining(['Ana', 'Bóris']),
    );
    expect(await screen.findAllByText('Friday Night Magic')).toHaveLength(2);
  });
});
