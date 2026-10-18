import { MantineProvider } from '@mantine/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { reduce, type MatchResult } from '../../domain';
import {
  TOURNAMENT_ID,
  playerIds,
  registeredLog,
  swissHistory,
  type LogBuilder,
} from '../../domain/fixtures/builders';
import { StandingsPanel } from './StandingsPanel';

const [A, B, C, D] = playerIds(4);
const WIN_20: MatchResult = { winsA: 2, winsB: 0, draws: 0, kind: 'played' };

function renderPanel(log: LogBuilder) {
  render(
    <MantineProvider env="test">
      <StandingsPanel state={reduce(log.events, TOURNAMENT_ID)} />
    </MantineProvider>,
  );
}

/** Cell texts of every body row, in order. */
const bodyRows = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );

/** Round 1 closed: A beat B 2-1, C beat D 2-0. */
const round1Closed = () =>
  swissHistory(playerIds(4), [
    [
      [A, B],
      [C, D, WIN_20],
    ],
  ]);

describe('StandingsPanel', () => {
  it('shows the empty state before round 1 is closed', () => {
    renderPanel(registeredLog(4));
    expect(screen.getByText('Standings appear when round 1 is closed.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lists every player with rank, MP, W-L-D and 2-decimal percentages', () => {
    renderPanel(round1Closed());
    const table = screen.getByRole('table', { name: 'Standings after round 1' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Rank', 'Player', 'MP', 'W-L-D', 'OMW%', 'GW%', 'OGW%']);
    // C (GW% 100%) ranks above A (GW% 2/3). B's GW% 1/3 shows 33.33%, D's 0 is floored to 33.00%.
    expect(bodyRows(table)).toEqual([
      ['1', 'Player 3', '3', '1-0-0', '33.00%', '100.00%', '33.00%'],
      ['2', 'Player 1', '3', '1-0-0', '33.00%', '66.67%', '33.33%'],
      ['3', 'Player 2', '0', '0-1-0', '100.00%', '33.33%', '66.67%'],
      ['4', 'Player 4', '0', '0-1-0', '100.00%', '33.00%', '100.00%'],
    ]);
  });

  it('shows a Dropped badge and keeps a ranked row for a dropped player', () => {
    renderPanel(round1Closed().add('PlayerDropped', { playerId: B }));
    const table = screen.getByRole('table', { name: 'Standings after round 1' });
    const row = within(table).getByText('Player 2').closest('tr')!;
    expect(within(row).getByText('Dropped')).toBeInTheDocument();
    expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('3');
    expect(within(table).getAllByText('Dropped')).toHaveLength(1);
  });
});
