import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ArchetypeStats } from '../../domain';
import { ArchetypeTable } from './ArchetypeTable';

function stats(
  archetype: string | null,
  players: number,
  [wins, losses, draws]: [number, number, number],
  gameWinRate: number | null,
  topCut: number,
): ArchetypeStats {
  const matches = wins + losses + draws;
  return {
    archetype,
    players,
    share: players / 10,
    matches: { wins, losses, draws },
    games: { won: 0, lost: 0, drawn: 0 },
    matchWinRate: matches === 0 ? null : wins / matches,
    gameWinRate,
    topCut,
  };
}

// Report order: players descending, then name; Unknown last.
const ARCHETYPES = [
  stats('Burn', 4, [3, 1, 0], 0.6, 2),
  stats('Elves', 2, [0, 2, 1], 0.2, 0),
  stats('Tron', 2, [0, 0, 0], null, 1),
  stats('Affinity', 1, [1, 0, 0], 1, 0),
  stats(null, 1, [1, 2, 0], 0.4, 0),
];

function renderTable() {
  render(
    <MantineProvider env="test">
      <ArchetypeTable archetypes={ARCHETYPES} />
    </MantineProvider>,
  );
}

const table = () => within(screen.getByRole('table', { name: 'Archetypes' }));
const names = () =>
  table()
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent);
const sortBy = (column: string) => fireEvent.click(table().getByRole('button', { name: column }));
const header = (column: string) => table().getByRole('columnheader', { name: column });

describe('ArchetypeTable', () => {
  it('shows every column, "—" for null rates, and Unknown last', () => {
    renderTable();
    const rows = table().getAllByRole('row');
    expect(
      within(rows[0])
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'Archetype',
      'Players ▼',
      'Share',
      'Record',
      'Match win %',
      'Game win %',
      'Top cut',
    ]);
    expect(
      within(rows[1])
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Burn', '4', '40.00%', '3-1-0', '75.00%', '60.00%', '2']);
    expect(
      within(rows[3])
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Tron', '2', '20.00%', '0-0-0', '—', '—', '1']);
    expect(names()).toEqual(['Burn', 'Elves', 'Tron', 'Affinity', 'Unknown']);
    expect(header('Players')).toHaveAttribute('aria-sort', 'descending');
  });

  it('sorts by each column both ways, null rates last and Unknown always last', () => {
    renderTable();

    sortBy('Archetype');
    expect(names()).toEqual(['Affinity', 'Burn', 'Elves', 'Tron', 'Unknown']);
    expect(header('Archetype')).toHaveAttribute('aria-sort', 'ascending');
    sortBy('Archetype');
    expect(names()).toEqual(['Tron', 'Elves', 'Burn', 'Affinity', 'Unknown']);

    sortBy('Players');
    expect(names()).toEqual(['Burn', 'Elves', 'Tron', 'Affinity', 'Unknown']);
    sortBy('Players');
    expect(names()).toEqual(['Affinity', 'Elves', 'Tron', 'Burn', 'Unknown']);

    sortBy('Share');
    expect(names()).toEqual(['Burn', 'Elves', 'Tron', 'Affinity', 'Unknown']);
    sortBy('Share');
    expect(names()).toEqual(['Affinity', 'Elves', 'Tron', 'Burn', 'Unknown']);

    // Matches played: Burn 4, Elves 3, Affinity 1, Tron 0.
    sortBy('Record');
    expect(names()).toEqual(['Burn', 'Elves', 'Affinity', 'Tron', 'Unknown']);
    sortBy('Record');
    expect(names()).toEqual(['Tron', 'Affinity', 'Elves', 'Burn', 'Unknown']);

    sortBy('Match win %');
    expect(names()).toEqual(['Affinity', 'Burn', 'Elves', 'Tron', 'Unknown']);
    sortBy('Match win %');
    expect(names()).toEqual(['Elves', 'Burn', 'Affinity', 'Tron', 'Unknown']);

    sortBy('Game win %');
    expect(names()).toEqual(['Affinity', 'Burn', 'Elves', 'Tron', 'Unknown']);
    sortBy('Game win %');
    expect(names()).toEqual(['Elves', 'Burn', 'Affinity', 'Tron', 'Unknown']);

    sortBy('Top cut');
    expect(names()).toEqual(['Burn', 'Tron', 'Elves', 'Affinity', 'Unknown']);
    expect(header('Top cut')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Players')).toHaveAttribute('aria-sort', 'none');
    sortBy('Top cut');
    expect(names()).toEqual(['Elves', 'Affinity', 'Tron', 'Burn', 'Unknown']);
  });
});
