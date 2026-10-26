import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../router';
import {
  emptyTimerRecord,
  readMuted,
  timerKey,
  writeTimerRecord,
  type TimerRecord,
} from '../storage/timerStorage';
import { TimerPage } from './TimerPage';
import { playBeep } from './timer/beep';

vi.mock('./timer/beep', () => ({
  playBeep: vi.fn(),
  unlockSound: vi.fn(),
  useSoundBlocked: () => false,
}));

const storage = vi.hoisted(() => ({ getStorage: vi.fn() }));
vi.mock('../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage')>()),
  getStorage: storage.getStorage,
}));

const ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-26T18:00:00Z').getTime();

const RECORD: TimerRecord = {
  ...emptyTimerRecord('Friday Modern'),
  openRound: { round: 3, stage: 'swiss', matches: 4 },
};

function withTimer(state: TimerRecord['timers'][number]['state']): TimerRecord {
  return { ...RECORD, timers: [{ round: 3, state }] };
}

function renderPage() {
  render(
    <MantineProvider env="test">
      <MemoryRouter initialEntries={[`/tournaments/${ID}/timer`]}>
        <Routes>
          <Route path="/tournaments/:id/timer" element={<TimerPage />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}

const clock = () => screen.getByTestId('timer-clock').textContent;

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Another window writes the record. */
function writeFromOtherWindow(record: TimerRecord) {
  const value = JSON.stringify(record);
  localStorage.setItem(timerKey(ID), value);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: timerKey(ID), newValue: value }));
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(playBeep).mockClear();
  storage.getStorage.mockClear();
});

describe('TimerPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says so when the tournament has no timer record', () => {
    renderPage();
    expect(screen.getByText('No round timer for this tournament.')).toBeInTheDocument();
  });

  it('waits for the next round when no round is open', () => {
    writeTimerRecord(ID, { ...RECORD, openRound: null });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Friday Modern' })).toBeInTheDocument();
    expect(screen.getByText('Waiting for the next round.')).toBeInTheDocument();
  });

  it('shows the round and "Not started" before the timer starts', () => {
    writeTimerRecord(ID, RECORD);
    renderPage();
    expect(screen.getByText('Round 3')).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('names a top cut round', () => {
    writeTimerRecord(ID, { ...RECORD, openRound: { round: 4, stage: 'topCut', matches: 1 } });
    renderPage();
    expect(screen.getByText('Final')).toBeInTheDocument();
  });

  it('counts down a running timer', () => {
    writeTimerRecord(ID, withTimer({ kind: 'running', endsAt: NOW + 10 * 60_000 }));
    renderPage();
    expect(clock()).toBe('10:00');
    advance(61_000);
    expect(clock()).toBe('08:59');
  });

  it('shows a paused timer', () => {
    writeTimerRecord(ID, withTimer({ kind: 'paused', remainingMs: 125_000 }));
    renderPage();
    advance(10_000);
    expect(clock()).toBe('02:05');
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('shows overtime without beeping when opened in overtime', () => {
    writeTimerRecord(ID, withTimer({ kind: 'running', endsAt: NOW - 30_000 }));
    renderPage();
    advance(1_000);
    expect(clock()).toBe('+00:31');
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(playBeep).not.toHaveBeenCalled();
  });

  it('beeps once at zero unless the big timer is muted', () => {
    writeTimerRecord(ID, withTimer({ kind: 'running', endsAt: NOW + 2_000 }));
    renderPage();
    advance(3_000);
    expect(playBeep).toHaveBeenCalledTimes(1);

    writeFromOtherWindow(withTimer({ kind: 'running', endsAt: NOW + 3_000 + 5_000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Mute timer sound' }));
    expect(readMuted('bigView')).toBe(true);
    expect(readMuted('page')).toBe(false);
    advance(6_000);
    expect(playBeep).toHaveBeenCalledTimes(1);
  });

  it('follows changes from the tournament page through storage events', () => {
    writeTimerRecord(ID, RECORD);
    renderPage();
    writeFromOtherWindow(withTimer({ kind: 'running', endsAt: NOW + 60_000 }));
    expect(clock()).toBe('01:00');
    writeFromOtherWindow(withTimer({ kind: 'paused', remainingMs: 59_000 }));
    expect(screen.getByText('Paused')).toBeInTheDocument();
    writeFromOtherWindow(RECORD);
    expect(screen.getByText('Not started')).toBeInTheDocument();
    writeFromOtherWindow({ ...RECORD, openRound: null });
    expect(screen.getByText('Waiting for the next round.')).toBeInTheDocument();
  });
});

describe('TimerPage route', () => {
  it('renders without the app navigation and never touches the storage backend', async () => {
    writeTimerRecord(ID, RECORD);
    const router = createMemoryRouter(routes, { initialEntries: [`/tournaments/${ID}/timer`] });
    render(
      <MantineProvider env="test">
        <RouterProvider router={router} />
      </MantineProvider>,
    );
    expect(await screen.findByText('Not started')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tournaments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(storage.getStorage).not.toHaveBeenCalled();
  });
});
