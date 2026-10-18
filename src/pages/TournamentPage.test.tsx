import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execute, type TournamentDocument } from '../domain';
import {
  CREATED_PAYLOAD,
  PLAYERS,
  TOURNAMENT_ID,
  addClosedRound,
  pairing,
  playerIds,
  registeredLog,
  runningDoc,
  swissHistory,
  uuid,
} from '../domain/fixtures/builders';
import { DexieBackend, type StorageBackend } from '../storage';
import { useTournamentStore } from '../store/tournamentStore';
import { TournamentPage } from './TournamentPage';

const mocks = vi.hoisted(() => {
  const current = { backend: null as unknown };
  // The app's stores take their backend at import time; this one forwards to `current.backend`.
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

let dbCount = 0;
let backend: StorageBackend;

beforeEach(() => {
  dbCount += 1;
  backend = new DexieBackend({ dbName: `test-tournament-page-${dbCount}` });
  mocks.current.backend = backend;
});

function autoDoc(players: number): TournamentDocument {
  // swissHistory with no rounds: any number of players, registered as `Player 1`…
  const log = swissHistory(playerIds(players), [], { ...CREATED_PAYLOAD, swissRounds: null });
  return { schemaVersion: 1, id: TOURNAMENT_ID, events: log.events };
}

function renderPage(id = TOURNAMENT_ID) {
  const router = createMemoryRouter([{ path: '/tournaments/:id', element: <TournamentPage /> }], {
    initialEntries: [`/tournaments/${id}`],
  });
  render(
    <MantineProvider env="test">
      <RouterProvider router={router} />
    </MantineProvider>,
  );
}

const roundsText = () =>
  within(screen.getByRole('rowheader', { name: 'Swiss rounds' }).closest('tr')!).getByRole('cell')
    .textContent;

async function idle() {
  await vi.waitFor(() => expect(useTournamentStore.getState().saving).toBe(false));
}

describe('TournamentPage', () => {
  it('shows the not-found state with a link to the list', async () => {
    renderPage(uuid(4242));
    expect(await screen.findByText('Tournament not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to tournaments' })).toHaveAttribute('href', '/');
  });

  it('shows other load errors with code and message', async () => {
    backend.loadTournament = async () => ({
      ok: false,
      error: { code: 'INVALID_DOCUMENT', message: 'broken' },
    });
    renderPage();
    expect(
      await screen.findByText('Could not load the tournament (INVALID_DOCUMENT): broken'),
    ).toBeInTheDocument();
  });

  it('shows the name, the details and "Saved"', async () => {
    await backend.saveTournament(autoDoc(4), null);
    renderPage();

    expect(
      await screen.findByRole('heading', { name: CREATED_PAYLOAD.name, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(roundsText()).toBe('Auto (2 for 4 players)');
  });

  it('updates the auto rounds text with the player count', async () => {
    await backend.saveTournament(autoDoc(4), null);
    renderPage();
    await screen.findByText('Auto (2 for 4 players)');

    act(() => {
      useTournamentStore.getState().dispatch({
        type: 'PlayerRegistered',
        payload: { playerId: uuid(150), playerName: 'Late' },
      });
    });

    expect(roundsText()).toBe('Auto (3 for 5 players)');
    await idle();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('saves an edited name and shows it in the header', async () => {
    await backend.saveTournament(autoDoc(2), null);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('heading', { name: 'Renamed', level: 1 })).toBeInTheDocument();
    await idle();
    const stored = await backend.loadTournament(TOURNAMENT_ID);
    expect(stored.ok && stored.value.state.name).toBe('Renamed');
  });

  it('shows a rejected details command under the card', async () => {
    const [P1, P2, P3, P4] = PLAYERS;
    // Running, 2 of 3 swiss rounds played: 1 round is below what was paired.
    const log = addClosedRound(
      addClosedRound(registeredLog(4), 1, 'swiss', [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)]),
      2,
      'swiss',
      [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)],
    );
    await backend.saveTournament({ schemaVersion: 1, id: TOURNAMENT_ID, events: log.events }, null);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Number of swiss rounds' }), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'INVALID_DETAILS: Swiss rounds cannot be 1: 2 swiss rounds are already paired',
      ),
    ).toBeInTheDocument();
    expect(useTournamentStore.getState().saving).toBe(false);
  });

  it('registers a clicked registry player and stores one PlayerRegistered', async () => {
    await backend.saveTournament(autoDoc(0), null);
    await backend.savePlayer({
      id: uuid(150),
      name: 'Alice',
      createdAt: '2026-10-11T18:00:00.000Z',
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Alice' }));

    expect(screen.getByRole('heading', { name: 'Registered (1)' })).toBeInTheDocument();
    await idle();
    const stored = await backend.loadTournament(TOURNAMENT_ID);
    expect(stored.ok && stored.value.doc.events.map((e) => e.type)).toEqual([
      'TournamentCreated',
      'PlayerRegistered',
    ]);
  });

  it('adds a new player to listPlayers and registers them', async () => {
    await backend.saveTournament(autoDoc(0), null);
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'New player' });

    fireEvent.change(input, { target: { value: 'Carmen' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('heading', { name: 'Registered (1)' })).toBeInTheDocument();
    await idle();
    const players = await backend.listPlayers();
    expect(players.ok && players.value.map((p) => p.name)).toEqual(['Carmen']);
    const stored = await backend.loadTournament(TOURNAMENT_ID);
    const registered = stored.ok ? Object.values(stored.value.state.players) : [];
    expect(registered).toMatchObject([
      { playerId: players.ok ? players.value[0].id : '', playerName: 'Carmen', guest: false },
    ]);
  });

  it('registers a guest who is not in listPlayers', async () => {
    await backend.saveTournament(autoDoc(0), null);
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Add guest' });

    fireEvent.change(input, { target: { value: 'Visitor' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('Guest')).toBeInTheDocument();
    await idle();
    expect(await backend.listPlayers()).toEqual({ ok: true, value: [] });
    const stored = await backend.loadTournament(TOURNAMENT_ID);
    expect(stored.ok && Object.values(stored.value.state.players)).toMatchObject([
      { playerName: 'Visitor', guest: true },
    ]);
  });

  it('starts on the Players tab when there are no rounds', async () => {
    await backend.saveTournament(autoDoc(2), null);
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Players' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'Round 1' })).not.toBeInTheDocument();
  });

  it('pairs round 1 for 9 players: a Round 1 tab, 5 matches with one bye, 4 auto rounds', async () => {
    await backend.saveTournament(autoDoc(9), null);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Pair round 1' }));

    expect(screen.getByRole('tab', { name: 'Round 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: /^Pair round/ })).not.toBeInTheDocument();
    await idle();
    const stored = await backend.loadTournament(TOURNAMENT_ID);
    if (!stored.ok) throw new Error('expected ok');
    const paired = stored.value.doc.events.filter((e) => e.type === 'RoundPaired');
    expect(paired).toHaveLength(1);
    const { matches } = stored.value.state.rounds[0];
    expect(matches).toHaveLength(5);
    expect(matches.filter((m) => m.playerB === null)).toHaveLength(1);
    expect(stored.value.state.swissRounds).toBe(4);
  });

  it('opens on the open round tab when a round is open', async () => {
    await backend.saveTournament(runningDoc(4), null);
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Round 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('shows the conflict notice and clears it with the close button', async () => {
    const doc = autoDoc(2);
    await backend.saveTournament(doc, null);
    renderPage();
    await screen.findByRole('button', { name: 'Edit details' });

    const other = execute(doc, {
      type: 'TournamentDetailsChanged',
      payload: { name: 'Other tab' },
    });
    if (!other.ok) throw new Error('expected ok');
    await backend.saveTournament(other.value.doc, '1');

    act(() => {
      useTournamentStore.getState().dispatch({
        type: 'TournamentDetailsChanged',
        payload: { location: 'Mine' },
      });
    });
    const alert = await screen.findByText(
      'This tournament was changed in another tab. Your last change was not saved. The latest version has been loaded.',
    );
    expect(screen.getByRole('heading', { name: 'Other tab', level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(alert).not.toBeInTheDocument();
  });

  it('shows the not-found notice when the tournament was deleted elsewhere', async () => {
    await backend.saveTournament(autoDoc(2), null);
    renderPage();
    await screen.findByRole('button', { name: 'Edit details' });
    await backend.deleteTournament(TOURNAMENT_ID, '1');

    act(() => {
      useTournamentStore.getState().dispatch({
        type: 'TournamentDetailsChanged',
        payload: { location: 'Mine' },
      });
    });

    expect(
      await screen.findByText(
        'This tournament no longer exists. It may have been deleted in another tab.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the save-failed notice with code and message', async () => {
    await backend.saveTournament(autoDoc(2), null);
    renderPage();
    await screen.findByRole('button', { name: 'Edit details' });
    vi.spyOn(backend, 'saveTournament').mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'Disk full' },
    });

    act(() => {
      useTournamentStore.getState().dispatch({
        type: 'TournamentDetailsChanged',
        payload: { location: 'Mine' },
      });
    });

    expect(
      await screen.findByText(
        'Could not save (UNAVAILABLE): Disk full. The last saved version has been loaded.',
      ),
    ).toBeInTheDocument();
  });
});
