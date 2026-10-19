import { MantineProvider } from '@mantine/core';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { reduce, type MatchResult, type TournamentEvent } from '../../domain';
import {
  PLAYERS,
  TOURNAMENT_ID,
  WIN_A,
  addClosedRound,
  matchId,
  pairing,
  registeredLog,
  type LogBuilder,
} from '../../domain/fixtures/builders';
import { useTournamentStore } from '../../store/tournamentStore';
import { HistoryPanel } from './HistoryPanel';

const [P1, P2, P3, P4, P5, P6] = PLAYERS;
const TIME = new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' });

beforeEach(() => {
  useTournamentStore.setState({ doc: null, state: null });
});

function renderPanel(events: TournamentEvent[]) {
  const doc = { schemaVersion: 1 as const, id: TOURNAMENT_ID, events };
  useTournamentStore.setState({ doc, state: reduce(events, TOURNAMENT_ID) });
  render(
    <MantineProvider env="test">
      <HistoryPanel />
    </MantineProvider>,
  );
}

/** Body rows, top to bottom. */
const bodyRows = () =>
  within(screen.getByRole('table', { name: 'History' }))
    .getAllByRole('row')
    .slice(1);

const rowCells = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

const rowOf = (seq: number) => bodyRows().find((row) => rowCells(row)[0] === `#${seq}`)!;

/** Seqs 1–5: created, 4 registered. 6: round 1 paired. 7–8: results. 9: round closed. */
const closedRound = (): LogBuilder =>
  addClosedRound(registeredLog(4), 1, 'swiss', [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)]);

describe('HistoryPanel', () => {
  it('shows #seq, the label and the time of every event, newest first', () => {
    const log = closedRound();
    renderPanel(log.events);

    const rows = bodyRows();
    expect(rows.map((row) => rowCells(row)[0])).toEqual([
      '#9',
      '#8',
      '#7',
      '#6',
      '#5',
      '#4',
      '#3',
      '#2',
      '#1',
    ]);
    expect(rowCells(rows[0]).slice(0, 3)).toEqual([
      '#9',
      'Round 1 closed',
      TIME.format(new Date(log.events[8].at)),
    ]);
  });

  it('labels every event type', () => {
    const intentionalDraw: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' };
    const unplayed: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'unplayed' };
    const draw: MatchResult = { winsA: 1, winsB: 1, draws: 1, kind: 'played' };
    const log = registeredLog(5)
      .add('PlayerRegistered', { playerId: P6, playerName: 'Eve' })
      .add('PlayerUnregistered', { playerId: P6 })
      .add('TournamentDetailsChanged', { name: 'Saturday', swissRounds: 1 })
      .add('RoundPaired', {
        round: 1,
        stage: 'swiss',
        pairings: [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4), pairing(3, 3, P5, null)],
      })
      .add('PlayersSwapped', { round: 1, playerA: P2, playerB: P3 })
      .add('ResultReported', { matchId: matchId(1), result: WIN_A })
      .add('ResultReported', { matchId: matchId(2), result: intentionalDraw })
      .add('ResultReported', { matchId: matchId(2), result: unplayed })
      .add('ResultReported', { matchId: matchId(2), result: draw })
      .add('RoundClosed', { round: 1 })
      .add('PlayerDropped', { playerId: P5 })
      .add('TopCutStarted', { size: 4 })
      .add('RolledBack', { toSeq: 17 })
      .add('TournamentFinished', {});
    renderPanel(log.events);

    expect(bodyRows().map((row) => rowCells(row)[1])).toEqual([
      'Tournament finished',
      'Rolled back to #17',
      'Top 4 startedUndone',
      'Player 5 dropped',
      'Round 1 closed',
      'Round 1: Player 2 1-1-1 Player 4',
      'Round 1: Player 2 Unplayed Player 4',
      'Round 1: Player 2 ID Player 4',
      'Round 1: Player 1 2-1 Player 3',
      'Round 1: Player 2 and Player 3 swapped',
      'Round 1 paired',
      'Details changed: Name, Swiss rounds',
      'Eve removed',
      'Eve registered',
      'Player 5 registered',
      'Player 4 registered',
      'Player 3 registered',
      'Player 2 registered',
      'Player 1 registered',
      'Tournament created',
    ]);
  });

  it('dims voided rows with an "Undone" badge and no rollback button', () => {
    const log = closedRound().add('RolledBack', { toSeq: 7 });
    renderPanel(log.events);

    for (const seq of [8, 9]) {
      expect(within(rowOf(seq)).getByText('Undone')).toBeInTheDocument();
      expect(within(rowOf(seq)).queryByRole('button')).not.toBeInTheDocument();
    }
    expect(within(rowOf(7)).queryByText('Undone')).not.toBeInTheDocument();
  });

  it('offers no rollback on the newest effective event or on RolledBack rows', () => {
    const log = closedRound()
      .add('RolledBack', { toSeq: 7 })
      .add('PlayerDropped', { playerId: P1 });
    renderPanel(log.events);

    expect(within(rowOf(11)).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rowOf(10)).queryByRole('button')).not.toBeInTheDocument();
    for (const seq of [7, 6, 1]) {
      expect(within(rowOf(seq)).getByRole('button', { name: 'Roll back to here' })).toBeEnabled();
    }
  });
});
