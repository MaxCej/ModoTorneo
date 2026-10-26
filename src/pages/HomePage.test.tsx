import { MantineProvider } from '@mantine/core';
import { render, screen, within } from '@testing-library/react';
import { HashRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TournamentDocument } from '../domain';
import { TOURNAMENT_ID } from '../domain/fixtures/builders';
import fixture from '../domain/fixtures/top4-8players.json';
import { DexieBackend, GitHubBackend, writeSettings, type StorageBackend } from '../storage';
import { FakeGitHub } from '../test/fakeGitHub';
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

describe('HomePage with GitHub storage', () => {
  const TOKEN = 'github_pat_home';
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
      dbName: `test-home-page-${dbCount}`,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('lists tournaments stored on GitHub', async () => {
    await seedFixture();
    renderPage();
    expect(await screen.findByRole('link', { name: 'Friday Night Magic' })).toBeInTheDocument();
  });

  it('shows the rejected-token alert with a link to Settings on a 401', async () => {
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
    fake.offline = true;
    renderPage();
    expect(await screen.findByText('Cannot reach GitHub: Failed to fetch')).toBeInTheDocument();
    expect(
      screen.queryByText('Local storage is unavailable in this browser.'),
    ).not.toBeInTheDocument();
  });
});
