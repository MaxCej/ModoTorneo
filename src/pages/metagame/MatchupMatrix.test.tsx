import { MantineProvider } from '@mantine/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { metagameReport, type Matchup, type MetagameSource } from '../../domain';
import { uuid } from '../../domain/fixtures/builders';
import { MatchupMatrix } from './MatchupMatrix';

/** Both sides of matches between `a` and `b`, from `a`'s record. */
function both(a: string | null, b: string | null, wins: number, losses: number): Matchup[] {
  const games = { won: 0, lost: 0, drawn: 0 };
  return [
    { archetype: a, opponent: b, wins, losses, draws: 0, games },
    { archetype: b, opponent: a, wins: losses, losses: wins, draws: 0, games },
  ];
}

// Nine archetypes (A9 goes to Other) and two Unknown players.
const SOURCE: MetagameSource = {
  id: uuid(1),
  date: '2026-01-01',
  format: 'modern',
  metagame: {
    archetypes: [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
        archetype: `A${n}`,
        players: 20 - n,
        topCut: 0,
      })),
      { archetype: 'A9', players: 1, topCut: 0 },
      { archetype: null, players: 2, topCut: 0 },
    ],
    matchups: [
      ...both('A1', 'A2', 2, 1),
      { ...both('A1', 'A1', 1, 0)[0] },
      { ...both('A1', 'A1', 1, 0)[1] },
      ...both(null, 'A9', 1, 0),
    ],
  },
};

function renderMatrix() {
  const report = metagameReport([SOURCE], { format: 'modern', from: null, to: null });
  render(
    <MantineProvider env="test">
      <MatchupMatrix groups={report.groups} matrix={report.matrix} />
    </MantineProvider>,
  );
}

const table = () =>
  within(
    screen.getByRole('table', {
      name: "Row archetype's match win % against the column archetype.",
    }),
  );
const row = (label: string) => table().getByRole('rowheader', { name: label }).closest('tr')!;
const cells = (label: string) =>
  within(row(label))
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('MatchupMatrix', () => {
  it('has one row and one column per group, Other and Unknown last', () => {
    renderMatrix();
    expect(screen.getByRole('heading', { name: 'Matchups', level: 2 })).toBeInTheDocument();
    const labels = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Other', 'Unknown'];
    expect(
      table()
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Archetype', ...labels]);
    expect(
      table()
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(labels);
  });

  it('shows win % and record, mirror counts, and "—" where groups never met', () => {
    renderMatrix();
    const a1 = cells('A1');
    expect(a1[0]).toBe('1 match');
    expect(a1[1]).toBe('66.67%2-1-0');
    expect(a1[2]).toBe('—');
    expect(cells('A2')[0]).toBe('33.33%1-2-0');
    expect(cells('Unknown')[8]).toBe('100.00%1-0-0');
    expect(cells('Other')[9]).toBe('0.00%0-1-0');
    expect(cells('Other')[8]).toBe('—');
  });
});
