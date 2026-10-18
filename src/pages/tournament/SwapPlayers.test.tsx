import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  err,
  execute,
  ok,
  reduce,
  type Command,
  type MatchResult,
  type TournamentDocument,
} from '../../domain';
import {
  TOURNAMENT_ID,
  matchId,
  pairing,
  playerIds,
  swissHistory,
  type LogBuilder,
} from '../../domain/fixtures/builders';
import { RoundPanel } from './RoundPanel';

const [A, B, C, D, E] = playerIds(5);
const WIN: MatchResult = { winsA: 2, winsB: 0, draws: 0, kind: 'played' };

/** Holds the document and applies each command with `execute`, like the store does. */
function renderRound(log: LogBuilder, round: number) {
  const dispatched: Command[] = [];

  function Harness() {
    const [doc, setDoc] = useState<TournamentDocument>({
      schemaVersion: 1,
      id: TOURNAMENT_ID,
      events: log.events,
    });
    const state = reduce(doc.events, doc.id);
    return (
      <RoundPanel
        state={state}
        round={state.rounds[round - 1]}
        onDispatch={(cmd) => {
          dispatched.push(cmd);
          const result = execute(doc, cmd);
          if (!result.ok) {
            return err(result.error);
          }
          setDoc(result.value.doc);
          return ok(result.value.state);
        }}
      />
    );
  }

  render(
    <MantineProvider env="test">
      <Harness />
    </MantineProvider>,
  );
  return { dispatched };
}

/** Round 1 played: A-B, C-D, E on the bye. Round 2 open: A-C (match 4), B-E (match 5), D bye. */
const round2Open = () =>
  swissHistory(playerIds(5), [
    [
      [A, B, WIN],
      [C, D, WIN],
      [E, null],
    ],
  ]).add('RoundPaired', {
    round: 2,
    stage: 'swiss',
    pairings: [pairing(4, 1, A, C), pairing(5, 2, B, E), pairing(6, 3, D, null)],
  });

const openSwap = () => fireEvent.click(screen.getByRole('button', { name: 'Swap players' }));
const optionsOf = (label: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  return screen.getAllByRole('option').map((option) => option.textContent);
};
const pick = (label: string, name: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name }));
};
const row = (table: number) => screen.getByRole('group', { name: `Table ${table}` });

describe('SwapPlayers', () => {
  it('offers every active player in an unreported match, bye included, in name order', () => {
    renderRound(round2Open(), 2);
    openSwap();
    expect(optionsOf('First player')).toEqual([
      'Player 1',
      'Player 2',
      'Player 3',
      'Player 4',
      'Player 5',
    ]);
  });

  it('leaves out players of a reported match and dropped players', () => {
    const log = round2Open()
      .add('ResultReported', { matchId: matchId(4), result: WIN })
      .add('PlayerDropped', { playerId: E });
    renderRound(log, 2);
    openSwap();
    // A and C are reported; E dropped. B and D remain.
    expect(optionsOf('First player')).toEqual(['Player 2', 'Player 4']);
  });

  it('leaves the first player and their opponent out of the second select', () => {
    renderRound(round2Open(), 2);
    openSwap();
    pick('First player', 'Player 1');
    // A plays C, so neither A nor C is offered.
    expect(optionsOf('Second player')).toEqual(['Player 2', 'Player 4', 'Player 5']);
  });

  it('swaps two players, updates both rows, and closes', () => {
    const { dispatched } = renderRound(round2Open(), 2);
    openSwap();
    pick('First player', 'Player 3');
    pick('Second player', 'Player 5');
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));

    expect(dispatched).toEqual([
      { type: 'PlayersSwapped', payload: { round: 2, playerA: C, playerB: E } },
    ]);
    // A-C, B-E become A-E, B-C.
    expect(within(row(1)).getByText(/^Player 5 /)).toBeInTheDocument();
    expect(within(row(2)).getByText(/^Player 3 /)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'First player' })).not.toBeInTheDocument();
  });

  it('shows the rematch warning a swap creates, naming both players', () => {
    renderRound(round2Open(), 2);
    expect(screen.queryByText(/^Rematch/)).not.toBeInTheDocument();

    openSwap();
    pick('First player', 'Player 2');
    pick('Second player', 'Player 3');
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));

    // A-C, B-E become A-B (round 1 rematch), C-E.
    expect(screen.getByText('Rematch at table 1: Player 1 vs Player 2.')).toBeInTheDocument();
  });

  it('shows a repeated bye after a swap moves the bye', () => {
    renderRound(round2Open(), 2);
    openSwap();
    pick('First player', 'Player 4');
    pick('Second player', 'Player 5');
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));

    // E had the bye in round 1 and takes it again.
    expect(screen.getByText('Player 5 already had a bye.')).toBeInTheDocument();
  });

  it('closes without dispatching on Cancel', () => {
    const { dispatched } = renderRound(round2Open(), 2);
    openSwap();
    pick('First player', 'Player 1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(dispatched).toEqual([]);
    expect(screen.getByRole('button', { name: 'Swap players' })).toBeInTheDocument();
  });

  it('is not offered in a closed round', () => {
    renderRound(round2Open(), 1);
    expect(screen.queryByRole('button', { name: 'Swap players' })).not.toBeInTheDocument();
  });
});
