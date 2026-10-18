import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  execute,
  ok,
  reduce,
  type Command,
  type DomainError,
  type Result,
  type TournamentState,
} from '../../domain';
import {
  CREATED_PAYLOAD,
  TOURNAMENT_ID,
  playerIds,
  registeredLog,
  runningDoc,
  swissHistory,
} from '../../domain/fixtures/builders';
import { RoundControls } from './RoundControls';

type Dispatch = (cmd: Command) => Result<TournamentState, DomainError>;

function renderControls(state: TournamentState, onDispatch?: Dispatch) {
  const dispatch = vi.fn<Dispatch>(onDispatch ?? (() => ok(state)));
  const onPaired = vi.fn();
  render(
    <MantineProvider env="test">
      <RoundControls state={state} onDispatch={dispatch} onPaired={onPaired} />
    </MantineProvider>,
  );
  return { dispatch, onPaired };
}

const pairButton = (round: number) => screen.queryByRole('button', { name: `Pair round ${round}` });

describe('RoundControls: Pair round N', () => {
  it('is disabled with fewer than 2 active players, with a hint', () => {
    renderControls(reduce(registeredLog(1).events, TOURNAMENT_ID));
    expect(pairButton(1)).toBeDisabled();
    expect(screen.getByText('Register at least 2 players')).toBeInTheDocument();
  });

  it('pairs round 1 and reports the round number', () => {
    const log = registeredLog(4);
    const doc = { schemaVersion: 1 as const, id: TOURNAMENT_ID, events: log.events };
    const state = reduce(log.events, TOURNAMENT_ID);
    const { dispatch, onPaired } = renderControls(state, (cmd) => {
      const result = execute(doc, cmd);
      return result.ok ? ok(result.value.state) : result;
    });

    fireEvent.click(pairButton(1)!);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const [cmd] = dispatch.mock.calls[0];
    expect(cmd).toMatchObject({ type: 'RoundPaired', payload: { round: 1, stage: 'swiss' } });
    expect(onPaired).toHaveBeenCalledWith(1);
  });

  it('does not report a pairing the store rejected', () => {
    const state = reduce(registeredLog(4).events, TOURNAMENT_ID);
    const { onPaired } = renderControls(state, () => ({
      ok: false,
      error: { code: 'WRONG_STATUS', message: 'Tournament no longer exists' },
    }));
    fireEvent.click(pairButton(1)!);
    expect(onPaired).not.toHaveBeenCalled();
  });

  it('is hidden while a round is open', () => {
    renderControls(reduce(runningDoc(4).events, TOURNAMENT_ID));
    expect(pairButton(1)).not.toBeInTheDocument();
    expect(pairButton(2)).not.toBeInTheDocument();
  });

  it('offers the next round once the round is closed', () => {
    const [a, b, c, d] = playerIds(4);
    const log = swissHistory(playerIds(4), [
      [
        [a, b],
        [c, d],
      ],
    ]);
    renderControls(reduce(log.events, TOURNAMENT_ID));
    expect(pairButton(2)).toBeEnabled();
  });

  it('is hidden after the last swiss round', () => {
    const [a, b] = playerIds(2);
    const log = swissHistory(playerIds(2), [[[a, b]]], { ...CREATED_PAYLOAD, swissRounds: 1 });
    renderControls(reduce(log.events, TOURNAMENT_ID));
    expect(pairButton(2)).not.toBeInTheDocument();
  });
});
