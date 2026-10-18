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

const [A, B, C, D] = playerIds(4);
const LOSS_A: MatchResult = { winsA: 0, winsB: 2, draws: 0, kind: 'played' };

/** Holds the document and applies each command with `execute`, like the store does. */
function renderRound(log: LogBuilder, round: number) {
  const dispatched: Command[] = [];
  let current: TournamentDocument = { schemaVersion: 1, id: TOURNAMENT_ID, events: log.events };

  function Harness() {
    const [doc, setDoc] = useState(current);
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
          current = result.value.doc;
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
  return { dispatched, doc: () => current };
}

const table = (n: number) => within(screen.getByRole('group', { name: `Table ${n}` }));

/** Round 1 played (A beat B, D beat C), round 2 open: A-D (match 3), B-C (match 4). */
const round2Open = () =>
  swissHistory(playerIds(4), [
    [
      [A, B],
      [C, D, LOSS_A],
    ],
  ]).add('RoundPaired', {
    round: 2,
    stage: 'swiss',
    pairings: [pairing(3, 1, A, D), pairing(4, 2, B, C)],
  });

describe('RoundPanel', () => {
  it('lists matches by table with points and record from earlier rounds', () => {
    renderRound(round2Open(), 2);
    expect(table(1).getByText('Player 1 (3 pts, 1-0-0)')).toBeInTheDocument();
    expect(table(1).getByText('Player 4 (3 pts, 1-0-0)')).toBeInTheDocument();
    expect(table(2).getByText('Player 2 (0 pts, 0-1-0)')).toBeInTheDocument();
    expect(table(2).getByText('Player 3 (0 pts, 0-1-0)')).toBeInTheDocument();
  });

  it('shows round 1 labels from before round 1, even after it was played', () => {
    renderRound(round2Open(), 1);
    expect(table(1).getByText('Player 1 (0 pts, 0-0-0)')).toBeInTheDocument();
  });

  it('reports a result, and a second click overwrites it', () => {
    const { dispatched, doc } = renderRound(round2Open(), 2);

    fireEvent.click(table(1).getByRole('button', { name: '2-1' }));
    fireEvent.click(table(1).getByRole('button', { name: '0-2' }));

    expect(dispatched).toEqual([
      {
        type: 'ResultReported',
        payload: {
          matchId: matchId(3),
          result: { winsA: 2, winsB: 1, draws: 0, kind: 'played' },
        },
      },
      {
        type: 'ResultReported',
        payload: {
          matchId: matchId(3),
          result: { winsA: 0, winsB: 2, draws: 0, kind: 'played' },
        },
      },
    ]);
    expect(table(1).getByRole('button', { name: '0-2' })).toHaveAttribute('aria-pressed', 'true');
    expect(table(1).getByRole('button', { name: '2-1' })).toHaveAttribute('aria-pressed', 'false');
    const state = reduce(doc().events, TOURNAMENT_ID);
    expect(state.rounds[1].matches[0].result).toMatchObject({ winsA: 0, winsB: 2 });
  });

  it('is read-only once the round is closed', () => {
    renderRound(round2Open(), 1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(table(1).getByText('2-1')).toBeInTheDocument();
    expect(table(2).getByText('0-2')).toBeInTheDocument();
  });
});

describe('RoundPanel by player', () => {
  /** 5 players named so name order differs from table order; round 1 open, E on the bye. */
  const named = () => {
    const ids = playerIds(5);
    const log = swissHistory([], []);
    const names = ['Diego', 'alice', 'Carmen', 'Bruno', 'Elena'];
    ids.forEach((playerId, i) => log.add('PlayerRegistered', { playerId, playerName: names[i] }));
    return log
      .add('RoundPaired', {
        round: 1,
        stage: 'swiss',
        pairings: [
          pairing(1, 1, ids[0], ids[1]),
          pairing(2, 2, ids[2], ids[3]),
          pairing(3, 3, ids[4], null),
        ],
      })
      .add('ResultReported', {
        matchId: matchId(1),
        result: { winsA: 2, winsB: 1, draws: 0, kind: 'played' },
      });
  };

  const showByPlayer = () => fireEvent.click(screen.getByRole('radio', { name: 'By player' }));
  const rows = () =>
    within(screen.getByRole('table', { name: 'Round 1 by player' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      );

  it('defaults to the by-table view', () => {
    renderRound(named(), 1);
    expect(screen.getByRole('radio', { name: 'By table' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'Table 1' })).toBeInTheDocument();
  });

  it('lists every player in name order with table, opponent and result from their side', () => {
    renderRound(named(), 1);
    showByPlayer();

    expect(rows()).toEqual([
      ['alice', '1', 'Diego', '1-2'],
      ['Bruno', '2', 'Carmen', 'No result'],
      ['Carmen', '2', 'Bruno', 'No result'],
      ['Diego', '1', 'alice', '2-1'],
      ['Elena', '3', 'Bye', '2-0'],
    ]);
    expect(screen.queryByRole('group', { name: 'Table 1' })).not.toBeInTheDocument();
  });

  it('is read-only', () => {
    renderRound(named(), 1);
    showByPlayer();
    expect(
      within(screen.getByRole('table', { name: 'Round 1 by player' })).queryByRole('button'),
    ).not.toBeInTheDocument();
  });

  it('switches back to the by-table view', () => {
    renderRound(named(), 1);
    showByPlayer();
    fireEvent.click(screen.getByRole('radio', { name: 'By table' }));
    expect(screen.getByRole('group', { name: 'Table 1' })).toBeInTheDocument();
  });
});
