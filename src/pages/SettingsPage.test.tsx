import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSettings, SETTINGS_KEY, writeSettings } from '../storage';
import { useTournamentStore } from '../store/tournamentStore';
import { FakeGitHub } from '../test/fakeGitHub';
import { SettingsPage } from './SettingsPage';

const TOKEN = 'github_pat_settings';

let fake: FakeGitHub;
let reload: ReturnType<typeof vi.fn<() => void>>;

function renderPage() {
  return render(
    <MantineProvider env="test">
      <SettingsPage reload={reload} fetchFn={fake.fetch} />
    </MantineProvider>,
  );
}

function fill(fields: Partial<{ owner: string; repo: string; token: string }>) {
  const values = { owner: 'alice', repo: 'mtg-data', token: TOKEN, ...fields };
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: values.owner } });
  fireEvent.change(screen.getByLabelText('Repository'), { target: { value: values.repo } });
  fireEvent.change(screen.getByLabelText('Fine-grained token'), {
    target: { value: values.token },
  });
}

const testButton = () => screen.getByRole('button', { name: 'Test connection' });
const connectButton = () => screen.getByRole('button', { name: 'Connect' });

async function runTest() {
  fireEvent.click(testButton());
  await screen.findByRole('alert');
}

beforeEach(() => {
  fake = new FakeGitHub({ token: TOKEN });
  reload = vi.fn<() => void>();
  localStorage.clear();
  useTournamentStore.setState({ saving: false, notice: null });
});

afterEach(() => {
  localStorage.clear();
});

describe('SettingsPage with local storage', () => {
  it('shows the status line, the fields and the help texts', () => {
    renderPage();
    expect(screen.getByText('Storage: this browser')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Create a private repository and a fine-grained token with access to that repository only and Contents: Read and write.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'To move existing data, export it on the Data page first, then import it after connecting.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it('needs all three fields to test', () => {
    renderPage();
    expect(testButton()).toBeDisabled();
    fill({ token: '' });
    expect(testButton()).toBeDisabled();
    fill({});
    expect(testButton()).toBeEnabled();
  });

  it('shows the green alert for a private repository and enables Connect', async () => {
    renderPage();
    fill({});
    expect(connectButton()).toBeDisabled();
    await runTest();
    expect(screen.getByRole('alert')).toHaveTextContent('Connected to alice/mtg-data.');
    expect(connectButton()).toBeEnabled();
  });

  it('shows the yellow warning for a public repository', async () => {
    fake.private = false;
    renderPage();
    fill({});
    await runTest();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Connected to alice/mtg-data. This repository is public: player names will be visible to anyone.',
    );
    expect(connectButton()).toBeEnabled();
  });

  it.each([
    ['a rejected token', () => (fake.token = 'other'), 'The token was rejected.'],
    [
      'a missing repository',
      () => (fake.repo = 'other'),
      'Repository not found, or the token has no access to it.',
    ],
    ['no push permission', () => (fake.push = false), 'The token cannot write to this repository.'],
    ['a network error', () => (fake.offline = true), 'Cannot reach GitHub: Failed to fetch'],
  ])('shows the red alert for %s and keeps Connect disabled', async (_name, arrange, text) => {
    arrange();
    renderPage();
    fill({});
    await runTest();
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(connectButton()).toBeDisabled();
  });

  it('disables Connect again when a field changes after a successful test', async () => {
    renderPage();
    fill({});
    await runTest();
    expect(connectButton()).toBeEnabled();
    fill({ repo: 'mtg-data-2' });
    expect(connectButton()).toBeDisabled();
    fill({});
    expect(connectButton()).toBeEnabled();
  });

  it('Connect writes the GitHub settings and reloads', async () => {
    renderPage();
    fill({ owner: ' alice ' });
    await runTest();
    fireEvent.click(connectButton());
    expect(readSettings()).toEqual({
      backend: 'github',
      owner: 'alice',
      repo: 'mtg-data',
      token: TOKEN,
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('disables Connect while the tournament store is saving or has unsaved work', async () => {
    renderPage();
    fill({});
    await runTest();
    act(() => useTournamentStore.setState({ saving: true }));
    expect(connectButton()).toBeDisabled();
    expect(screen.getByText('Wait until the current tournament is saved.')).toBeInTheDocument();
    act(() =>
      useTournamentStore.setState({
        saving: false,
        notice: { kind: 'unsaved', error: { code: 'UNAVAILABLE', message: 'offline' } },
      }),
    );
    expect(connectButton()).toBeDisabled();
    act(() => useTournamentStore.setState({ notice: null }));
    expect(connectButton()).toBeEnabled();
  });
});

describe('SettingsPage with GitHub storage', () => {
  beforeEach(() => {
    writeSettings({ backend: 'github', owner: 'alice', repo: 'mtg-data', token: TOKEN });
  });

  it('shows the status line and hides the fields', () => {
    renderPage();
    expect(screen.getByText('Storage: GitHub (alice/mtg-data)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fine-grained token')).not.toBeInTheDocument();
  });

  it('Disconnect writes local settings and reloads', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(localStorage.getItem(SETTINGS_KEY)).toBe('{"backend":"local"}');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('disables Disconnect while saving', () => {
    useTournamentStore.setState({ saving: true });
    renderPage();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled();
    expect(screen.getByText('Wait until the current tournament is saved.')).toBeInTheDocument();
  });
});
