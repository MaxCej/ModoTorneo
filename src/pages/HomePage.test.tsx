import { MantineProvider } from '@mantine/core';
import { render, screen, within } from '@testing-library/react';
import { HashRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TournamentDocument } from '../domain';
import { TOURNAMENT_ID } from '../domain/fixtures/builders';
import fixture from '../domain/fixtures/top4-8players.json';
import { DexieBackend, type StorageBackend } from '../storage';
import { HomePage } from './HomePage';

const mocks = vi.hoisted(() => ({ backend: null as StorageBackend | null }));

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>();
  return { ...actual, getStorage: () => mocks.backend! };
});

let dbCount = 0;

beforeEach(() => {
  dbCount += 1;
  mocks.backend = new DexieBackend({ dbName: `test-home-page-${dbCount}` });
});

function renderPage() {
  render(
    <MantineProvider>
      <HashRouter>
        <HomePage />
      </HashRouter>
    </MantineProvider>,
  );
}

async function seedFixture() {
  await mocks.backend!.saveTournament(structuredClone(fixture) as TournamentDocument, null);
}

describe('HomePage', () => {
  it('shows the title, the New tournament button and the empty state', async () => {
    renderPage();
    expect(
      await screen.findByText('No tournaments yet. Create one to get started.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tournaments' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New tournament' })).toHaveAttribute(
      'href',
      '#/tournaments/new',
    );
  });

  it('lists the fixture with its player count', async () => {
    await seedFixture();
    renderPage();

    const link = await screen.findByRole('link', { name: 'Friday Night Magic' });
    const cells = within(link.closest('tr')!)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells).toEqual(['Friday Night Magic', '2026-10-11', 'Modern', 'Finished', '8']);
    expect(screen.getByRole('columnheader', { name: 'Players' })).toBeInTheDocument();
  });

  it('links the name to the tournament page', async () => {
    await seedFixture();
    renderPage();

    expect(await screen.findByRole('link', { name: 'Friday Night Magic' })).toHaveAttribute(
      'href',
      `#/tournaments/${TOURNAMENT_ID}`,
    );
  });

  it('never loads documents', async () => {
    await seedFixture();
    const load = vi.spyOn(mocks.backend!, 'loadTournament');
    renderPage();

    await screen.findByRole('link', { name: 'Friday Night Magic' });
    expect(load).not.toHaveBeenCalled();
  });

  it('shows the unavailable alert', async () => {
    mocks.backend!.listTournaments = async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'blocked' },
    });
    renderPage();
    expect(
      await screen.findByText('Local storage is unavailable in this browser.'),
    ).toBeInTheDocument();
  });

  it('shows other load errors with code and message', async () => {
    mocks.backend!.listTournaments = async () => ({
      ok: false,
      error: { code: 'INVALID_DOCUMENT', message: 'broken' },
    });
    renderPage();
    expect(
      await screen.findByText('Could not load tournaments (INVALID_DOCUMENT): broken'),
    ).toBeInTheDocument();
  });
});
