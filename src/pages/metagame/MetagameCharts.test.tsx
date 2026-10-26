import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ArchetypeStats, MetagameGroup } from '../../domain';
import { MetagameCharts, metagameChartData } from './MetagameCharts';

function stats(archetype: string | null, share: number, matchWinRate: number | null) {
  return {
    archetype,
    players: 1,
    share,
    matches: { wins: 0, losses: 0, draws: 0 },
    games: { won: 0, lost: 0, drawn: 0 },
    matchWinRate,
    gameWinRate: null,
    topCut: 0,
  } satisfies ArchetypeStats;
}

const GROUPS: MetagameGroup[] = [
  { kind: 'archetype', stats: stats('Burn', 0.5, 2 / 3) },
  { kind: 'archetype', stats: stats('Tron', 0.125, null) },
  { kind: 'other', members: 2, stats: stats(null, 0.25, 0.5) },
  { kind: 'unknown', stats: stats(null, 0.125, 0) },
];

const labelOf = (group: MetagameGroup) =>
  group.kind === 'archetype' ? group.stats.archetype! : group.kind;

describe('metagameChartData', () => {
  it('gives every group a share, in percent with two decimals', () => {
    expect(metagameChartData(GROUPS, labelOf).share).toEqual([
      { label: 'Burn', value: 50 },
      { label: 'Tron', value: 12.5 },
      { label: 'other', value: 25 },
      { label: 'unknown', value: 12.5 },
    ]);
  });

  it('leaves groups with a null match win rate out of the win % chart', () => {
    expect(metagameChartData(GROUPS, labelOf).winRate).toEqual([
      { label: 'Burn', value: 66.67 },
      { label: 'other', value: 50 },
      { label: 'unknown', value: 0 },
    ]);
  });
});

describe('MetagameCharts', () => {
  function renderCharts(groups: MetagameGroup[]) {
    render(
      <MantineProvider env="test">
        <MetagameCharts groups={groups} />
      </MantineProvider>,
    );
  }

  it('renders both charts under their headings', () => {
    renderCharts(GROUPS);
    expect(screen.getByRole('heading', { name: 'Share', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Match win %', level: 2 })).toBeInTheDocument();
  });

  it('leaves the win % chart out when no group has a match', () => {
    renderCharts([{ kind: 'archetype', stats: stats('Burn', 1, null) }]);
    expect(screen.getByRole('heading', { name: 'Share', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Match win %' })).not.toBeInTheDocument();
  });
});
