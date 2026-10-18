import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Match, MatchResult } from '../../domain';
import { matchId, PLAYERS } from '../../domain/fixtures/builders';
import { MatchRow, RESULT_PRESETS } from './MatchRow';

const [P1, P2] = PLAYERS;

function renderRow(match: Match, readOnly = false) {
  const onReport = vi.fn<(result: MatchResult) => void>();
  render(
    <MantineProvider env="test">
      <MatchRow
        match={match}
        labelA="Alice (3 pts, 1-0-0)"
        labelB={match.playerB === null ? null : 'Bruno (0 pts, 0-1-0)'}
        readOnly={readOnly}
        onReport={onReport}
      />
    </MantineProvider>,
  );
  return { onReport, row: within(screen.getByRole('group', { name: `Table ${match.table}` })) };
}

const open = (result: MatchResult | null = null): Match => ({
  matchId: matchId(1),
  table: 3,
  playerA: P1,
  playerB: P2,
  result,
});

const PRESET_CASES: Array<[string, MatchResult]> = [
  ['2-0', { winsA: 2, winsB: 0, draws: 0, kind: 'played' }],
  ['2-1', { winsA: 2, winsB: 1, draws: 0, kind: 'played' }],
  ['1-2', { winsA: 1, winsB: 2, draws: 0, kind: 'played' }],
  ['0-2', { winsA: 0, winsB: 2, draws: 0, kind: 'played' }],
  ['1-1-1', { winsA: 1, winsB: 1, draws: 1, kind: 'played' }],
  ['ID', { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' }],
  ['Unplayed', { winsA: 0, winsB: 0, draws: 0, kind: 'unplayed' }],
];

describe('MatchRow', () => {
  it('shows the table and both labels', () => {
    const { row } = renderRow(open());
    expect(row.getByText('Table 3')).toBeInTheDocument();
    expect(row.getByText('Alice (3 pts, 1-0-0)')).toBeInTheDocument();
    expect(row.getByText('Bruno (0 pts, 0-1-0)')).toBeInTheDocument();
  });

  it.each(PRESET_CASES)('reports %s as its MatchResult', (label, result) => {
    const { onReport, row } = renderRow(open());
    fireEvent.click(row.getByRole('button', { name: label }));
    expect(onReport).toHaveBeenCalledWith(result);
  });

  it('has exactly the 7 presets of the spec', () => {
    expect(RESULT_PRESETS.map((preset) => preset.result)).toEqual(
      PRESET_CASES.map(([, result]) => result),
    );
  });

  it('highlights the current result and only that one', () => {
    const { row } = renderRow(open({ winsA: 2, winsB: 1, draws: 0, kind: 'played' }));
    const pressed = row
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((button) => button.textContent)).toEqual(['2-1']);
  });

  it('highlights nothing before a result is reported', () => {
    const { row } = renderRow(open());
    const pressed = row
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed).toEqual([]);
  });

  it('shows a bye with no result controls', () => {
    const { row } = renderRow({ ...open(), playerB: null, result: null });
    expect(row.getByText('Bye')).toBeInTheDocument();
    expect(row.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the result as text, without buttons, when read-only', () => {
    const { row } = renderRow(open({ winsA: 0, winsB: 2, draws: 0, kind: 'played' }), true);
    expect(row.getByText('0-2')).toBeInTheDocument();
    expect(row.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows "No result" when read-only without a result', () => {
    const { row } = renderRow(open(), true);
    expect(row.getByText('No result')).toBeInTheDocument();
  });
});
