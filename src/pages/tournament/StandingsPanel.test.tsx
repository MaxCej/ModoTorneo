import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { reduce, type MatchResult } from '../../domain';
import {
  TOURNAMENT_ID,
  matchId,
  pairing,
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
      <MemoryRouter>
        <StandingsPanel state={reduce(log.events, TOURNAMENT_ID)} />
      </MemoryRouter>
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
    ).toEqual(['Rank', 'Player', 'Deck', 'MP', 'W-L-D', 'OMW%', 'GW%', 'OGW%']);
    // C (GW% 100%) ranks above A (GW% 2/3). B's GW% 1/3 shows 33.33%, D's 0 is floored to 33.00%.
    expect(bodyRows(table)).toEqual([
      ['1', 'Player 3', '—', '3', '1-0-0', '33.00%', '100.00%', '33.00%'],
      ['2', 'Player 1', '—', '3', '1-0-0', '33.00%', '66.67%', '33.33%'],
      ['3', 'Player 2', '—', '0', '0-1-0', '100.00%', '33.33%', '66.67%'],
      ['4', 'Player 4', '—', '0', '0-1-0', '100.00%', '33.00%', '100.00%'],
    ]);
  });

  it("shows each player's archetype in the Deck column", () => {
    renderPanel(
      round1Closed().add('DeckSet', { playerId: A, archetype: 'Burn', main: [], sideboard: [] }),
    );
    const table = screen.getByRole('table', { name: 'Standings after round 1' });
    expect(bodyRows(table).map((row) => [row[1], row[2]])).toEqual([
      ['Player 3', '—'],
      ['Player 1', 'Burn'],
      ['Player 2', '—'],
      ['Player 4', '—'],
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

  describe('After round picker', () => {
    /** Round 1: A beat B, C beat D. Round 2: A beat C, D beat B. Both closed. */
    const round2Closed = () =>
      swissHistory(playerIds(4), [
        [
          [A, B],
          [C, D, WIN_20],
        ],
        [
          [A, C],
          [D, B],
        ],
      ]);
    const picker = () => screen.getByRole('combobox', { name: 'After round' });

    it('defaults to the last closed round', () => {
      renderPanel(round2Closed());
      expect(picker()).toHaveValue('Round 2');
      const table = screen.getByRole('table', { name: 'Standings after round 2' });
      expect(bodyRows(table).map((row) => [row[1], row[3], row[4]])).toEqual([
        ['Player 1', '6', '2-0-0'],
        ['Player 3', '3', '1-1-0'],
        ['Player 4', '3', '1-1-0'],
        ['Player 2', '0', '0-2-0'],
      ]);
    });

    it("shows an earlier round's standings when picked", () => {
      renderPanel(round2Closed());
      fireEvent.click(picker());
      fireEvent.click(screen.getByRole('option', { name: 'Round 1' }));

      expect(picker()).toHaveValue('Round 1');
      const table = screen.getByRole('table', { name: 'Standings after round 1' });
      expect(bodyRows(table).map((row) => [row[1], row[3], row[4]])).toEqual([
        ['Player 3', '3', '1-0-0'],
        ['Player 1', '3', '1-0-0'],
        ['Player 2', '0', '0-1-0'],
        ['Player 4', '0', '0-1-0'],
      ]);
    });

    it('does not offer the open round, and ignores its reported results', () => {
      const log = round1Closed()
        .add('RoundPaired', {
          round: 2,
          stage: 'swiss',
          pairings: [pairing(3, 1, A, C), pairing(4, 2, B, D)],
        })
        .add('ResultReported', { matchId: matchId(3), result: WIN_20 });
      renderPanel(log);

      expect(picker()).toHaveValue('Round 1');
      fireEvent.click(picker());
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Round 1']);
      const table = screen.getByRole('table', { name: 'Standings after round 1' });
      expect(bodyRows(table).map((row) => [row[1], row[3]])).toEqual([
        ['Player 3', '3'],
        ['Player 1', '3'],
        ['Player 2', '0'],
        ['Player 4', '0'],
      ]);
    });
  });

  it('links registry players to their profile and shows guests as plain text', () => {
    const guest = playerIds(5)[4];
    const log = registeredLog(4).add('PlayerRegistered', {
      playerId: guest,
      playerName: 'Guest',
      guest: true,
    });
    log.add('RoundPaired', {
      round: 1,
      stage: 'swiss',
      pairings: [pairing(1, 1, A, B), pairing(2, 2, C, D), pairing(3, 3, guest, null)],
    });
    log.add('ResultReported', { matchId: matchId(1), result: WIN_20 });
    log.add('ResultReported', { matchId: matchId(2), result: WIN_20 });
    log.add('RoundClosed', { round: 1 });
    renderPanel(log);

    expect(screen.getByRole('link', { name: 'Player 1' })).toHaveAttribute('href', `/players/${A}`);
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Guest' })).not.toBeInTheDocument();
  });
});
