import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { reduce, type MatchResult, type TournamentState } from '../../domain';
import {
  CREATED_PAYLOAD,
  TOURNAMENT_ID,
  playerIds,
  swissHistory,
  type HistoryMatch,
} from '../../domain/fixtures/builders';
import { StartTopCutModal } from './StartTopCutModal';

const ID: MatchResult = { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' };

/** `count` players, one closed swiss round of `swissRounds`: player 1 v 2, 3 v 4… (A wins). */
function oneRound(count: number, swissRounds = 1, last?: MatchResult): TournamentState {
  const ids = playerIds(count);
  const matches: HistoryMatch[] = [];
  for (let i = 0; i < count; i += 2) {
    matches.push([ids[i], ids[i + 1] ?? null]);
  }
  if (last !== undefined) {
    const [a, b] = matches[matches.length - 1];
    matches[matches.length - 1] = [a, b, last];
  }
  const log = swissHistory(ids, [matches], { ...CREATED_PAYLOAD, swissRounds });
  return reduce(log.events, TOURNAMENT_ID);
}

function renderModal(state: TournamentState) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <MantineProvider env="test">
      <StartTopCutModal state={state} onCancel={onCancel} onConfirm={onConfirm} />
    </MantineProvider>,
  );
  return {
    onConfirm,
    onCancel,
    dialog: within(screen.getByRole('dialog', { name: 'Start top cut' })),
  };
}

const sizeInput = () => screen.getByLabelText('Size', { selector: 'input' });

const seedNames = (dialog: ReturnType<typeof within>) =>
  within(dialog.getByRole('table', { name: 'Seeds' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1].textContent);

describe('StartTopCutModal', () => {
  it.each([
    [12, 'Top 4'],
    [20, 'Top 8'],
    [6, 'Top 4'],
  ])('preselects the default size for %i active players', (count, label) => {
    renderModal(oneRound(count));
    expect(sizeInput()).toHaveValue(label);
  });

  it('shows the hint below 8 active players only', () => {
    renderModal(oneRound(6));
    expect(
      screen.getByText('Fewer than 8 players: a top cut is not recommended.'),
    ).toBeInTheDocument();
  });

  it('shows no hint from 8 active players', () => {
    renderModal(oneRound(8));
    expect(
      screen.queryByText('Fewer than 8 players: a top cut is not recommended.'),
    ).not.toBeInTheDocument();
  });

  it('disables sizes above the active player count', () => {
    renderModal(oneRound(12));
    fireEvent.click(sizeInput());
    const option = (label: string) => screen.getByRole('option', { name: label, hidden: true });
    expect(option('Top 4')).not.toHaveAttribute('data-combobox-disabled');
    expect(option('Top 8')).not.toHaveAttribute('data-combobox-disabled');
    expect(option('Top 16')).toHaveAttribute('data-combobox-disabled');
    expect(option('Top 32')).toHaveAttribute('data-combobox-disabled');
  });

  it('lists the seeds in standings order and updates them with the size', () => {
    // 8 players, all 2-1 for A: players 1, 3, 5, 7 share rank 1.
    const { dialog } = renderModal(oneRound(8));
    expect(seedNames(dialog)).toEqual([
      'Player 1Tied',
      'Player 3Tied',
      'Player 5Tied',
      'Player 7Tied',
    ]);
    expect(dialog.getByText('Tied players are seeded in random order.')).toBeInTheDocument();
  });

  it('names a tie at the cut line', () => {
    // Players 7 and 8 draw: 1, 3, 5 share rank 1, 7 and 8 share rank 4.
    const { dialog } = renderModal(oneRound(8, 1, ID));
    expect(
      dialog.getByText(
        'Player 7, Player 8 are tied at the cut line. A random draw decides who makes the cut.',
      ),
    ).toBeInTheDocument();
    expect(dialog.getByText('Tied players are seeded in random order.')).toBeInTheDocument();
  });

  it('notes the swiss rounds played when swiss stops early', () => {
    const { dialog } = renderModal(oneRound(8, 3));
    expect(dialog.getByText('1 of 3 swiss rounds played.')).toBeInTheDocument();
  });

  it('says nothing about swiss rounds after the last one', () => {
    const { dialog } = renderModal(oneRound(8, 1));
    expect(dialog.queryByText(/swiss rounds played/)).not.toBeInTheDocument();
  });

  it('confirms with the chosen size and best-of', () => {
    const { dialog, onConfirm } = renderModal(oneRound(8));
    fireEvent.click(dialog.getByText('Best of 5'));
    fireEvent.click(dialog.getByRole('button', { name: 'Start top cut' }));
    expect(onConfirm).toHaveBeenCalledWith(4, 5);
  });

  it('cancels without confirming', () => {
    const { dialog, onConfirm, onCancel } = renderModal(oneRound(8));
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
