import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BestOf, Deck, Match, MatchResult } from '../../domain';
import { matchId, PLAYERS } from '../../domain/fixtures/builders';
import { MatchRow, RESULT_PRESETS, TOP_CUT_PRESETS } from './MatchRow';

const [P1, P2] = PLAYERS;

function renderRow(
  match: Match,
  readOnly = false,
  topCutBestOf?: BestOf,
  decks: { deckA?: Deck | null; deckB?: Deck | null } = {},
) {
  const onReport = vi.fn<(result: MatchResult) => void>();
  render(
    <MantineProvider env="test">
      <MatchRow
        match={match}
        labelA="Alice (3 pts, 1-0-0)"
        labelB={match.playerB === null ? null : 'Bruno (0 pts, 0-1-0)'}
        readOnly={readOnly}
        stage={topCutBestOf === undefined ? 'swiss' : 'topCut'}
        bestOf={topCutBestOf}
        onReport={onReport}
        {...decks}
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

  it("shows each player's archetype under the name, and nothing without one", () => {
    const { row } = renderRow(open(), false, undefined, {
      deckA: { archetype: 'Burn', main: [], sideboard: [] },
      deckB: { main: [{ quantity: 4, name: 'Opt' }], sideboard: [] },
    });
    const nameA = row.getByText('Alice (3 pts, 1-0-0)');
    expect(nameA.nextElementSibling).toHaveTextContent('Burn');
    expect(row.getByText('Bruno (0 pts, 0-1-0)').nextElementSibling).toBeNull();
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

describe('MatchRow custom result', () => {
  function enter(row: ReturnType<typeof within>, winsA: string, winsB: string, draws: string) {
    fireEvent.click(row.getByRole('button', { name: 'Custom' }));
    fireEvent.change(row.getByRole('textbox', { name: 'Wins A' }), { target: { value: winsA } });
    fireEvent.change(row.getByRole('textbox', { name: 'Wins B' }), { target: { value: winsB } });
    fireEvent.change(row.getByRole('textbox', { name: 'Draws' }), { target: { value: draws } });
    fireEvent.click(row.getByRole('button', { name: 'Save' }));
  }

  it('reports a valid custom result and closes', () => {
    const { onReport, row } = renderRow(open());
    enter(row, '1', '0', '0');
    expect(onReport).toHaveBeenCalledWith({ winsA: 1, winsB: 0, draws: 0, kind: 'played' });
    expect(row.queryByRole('textbox', { name: 'Wins A' })).not.toBeInTheDocument();
  });

  it.each([
    ['3-0-0, more than 2 wins', '3', '0', '0'],
    ['2-2-0, more than 3 games', '2', '2', '0'],
    ['0-0-0, no game', '0', '0', '0'],
    ['an empty count', '', '1', '0'],
  ])('rejects %s and reports nothing', (_, a, b, d) => {
    const { onReport, row } = renderRow(open());
    enter(row, a, b, d);
    expect(onReport).not.toHaveBeenCalled();
    expect(
      row.getByText('Enter a best-of-three result: at most 2 wins each and 3 games in total.'),
    ).toBeInTheDocument();
  });

  it('clears the error when a count changes', () => {
    const { row } = renderRow(open());
    enter(row, '3', '0', '0');
    fireEvent.change(row.getByRole('textbox', { name: 'Wins A' }), { target: { value: '2' } });
    expect(row.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes without reporting on Cancel', () => {
    const { onReport, row } = renderRow(open());
    fireEvent.click(row.getByRole('button', { name: 'Custom' }));
    fireEvent.click(row.getByRole('button', { name: 'Cancel' }));
    expect(onReport).not.toHaveBeenCalled();
    expect(row.queryByRole('textbox', { name: 'Wins A' })).not.toBeInTheDocument();
  });

  it('shows a custom result that matches no preset as text, with no preset highlighted', () => {
    const { row } = renderRow(open({ winsA: 1, winsB: 0, draws: 1, kind: 'played' }));
    expect(row.getByText('1-0-1')).toBeInTheDocument();
    const pressed = row
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed).toEqual([]);
  });

  it('starts from the current played result', () => {
    const { row } = renderRow(open({ winsA: 1, winsB: 0, draws: 1, kind: 'played' }));
    fireEvent.click(row.getByRole('button', { name: 'Custom' }));
    expect(row.getByRole('textbox', { name: 'Wins A' })).toHaveValue('1');
    expect(row.getByRole('textbox', { name: 'Draws' })).toHaveValue('1');
  });
});

describe('MatchRow in a top cut round', () => {
  const buttonLabels = (row: ReturnType<typeof within>) =>
    row
      .getAllByRole('button')
      .map((button: HTMLElement) => button.textContent)
      .filter((label: string | null) => label !== 'Custom');

  it('offers 2-0, 2-1, 1-2 and 0-2 in best of three', () => {
    const { row } = renderRow(open(), false, 3);
    expect(buttonLabels(row)).toEqual(['2-0', '2-1', '1-2', '0-2']);
  });

  it.each([
    ['3-0', 3, 0],
    ['3-1', 3, 1],
    ['3-2', 3, 2],
    ['2-3', 2, 3],
    ['1-3', 1, 3],
    ['0-3', 0, 3],
  ])('reports %s in best of five', (label, winsA, winsB) => {
    const { onReport, row } = renderRow(open(), false, 5);
    fireEvent.click(row.getByRole('button', { name: label }));
    expect(onReport).toHaveBeenCalledWith({ winsA, winsB, draws: 0, kind: 'played' });
  });

  it('has exactly the best of five presets of the spec', () => {
    const { row } = renderRow(open(), false, 5);
    expect(buttonLabels(row)).toEqual(['3-0', '3-1', '3-2', '2-3', '1-3', '0-3']);
    expect(TOP_CUT_PRESETS[5]).toHaveLength(6);
  });

  it('offers no draw, ID or Unplayed', () => {
    const { row } = renderRow(open(), false, 5);
    for (const label of ['1-1-1', 'ID', 'Unplayed']) {
      expect(row.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('keeps the swiss presets in a swiss round', () => {
    const { row } = renderRow(open());
    expect(buttonLabels(row)).toEqual(['2-0', '2-1', '1-2', '0-2', '1-1-1', 'ID', 'Unplayed']);
  });

  function enter(row: ReturnType<typeof within>, winsA: string, winsB: string, draws: string) {
    fireEvent.click(row.getByRole('button', { name: 'Custom' }));
    fireEvent.change(row.getByRole('textbox', { name: 'Wins A' }), { target: { value: winsA } });
    fireEvent.change(row.getByRole('textbox', { name: 'Wins B' }), { target: { value: winsB } });
    fireEvent.change(row.getByRole('textbox', { name: 'Draws' }), { target: { value: draws } });
    fireEvent.click(row.getByRole('button', { name: 'Save' }));
  }

  it.each([
    ['2-2, no winner', '2', '2', '0'],
    ['4-0, more than 3 wins', '4', '0', '0'],
    ['3-2-1, more than 5 games', '3', '2', '1'],
  ])('custom refuses %s in best of five', (_, a, b, d) => {
    const { onReport, row } = renderRow(open(), false, 5);
    enter(row, a, b, d);
    expect(onReport).not.toHaveBeenCalled();
    expect(
      row.getByText(
        'Enter a best-of-5 result with a winner: at most 3 wins each and 5 games in total.',
      ),
    ).toBeInTheDocument();
  });

  it('custom accepts 3-1-1 in best of five', () => {
    const { onReport, row } = renderRow(open(), false, 5);
    enter(row, '3', '1', '1');
    expect(onReport).toHaveBeenCalledWith({ winsA: 3, winsB: 1, draws: 1, kind: 'played' });
  });

  it('custom refuses 3-0 in best of three', () => {
    const { onReport, row } = renderRow(open(), false, 3);
    enter(row, '3', '0', '0');
    expect(onReport).not.toHaveBeenCalled();
  });
});
