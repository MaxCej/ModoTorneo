import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  WIN_A,
  matchId,
  pairing,
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

describe('RoundControls: Close round N', () => {
  const [a, b, c, d, e] = playerIds(5);

  /** 5 players, round 1 open: a-b (match 1), c-d (match 2), e on the bye. */
  const round1Open = () =>
    swissHistory(playerIds(5), []).add('RoundPaired', {
      round: 1,
      stage: 'swiss',
      pairings: [pairing(1, 1, a, b), pairing(2, 2, c, d), pairing(3, 3, e, null)],
    });
  const closeButton = () => screen.getByRole('button', { name: 'Close round 1' });

  it('is disabled with a missing result and counts played matches only', () => {
    const log = round1Open().add('ResultReported', { matchId: matchId(1), result: WIN_A });
    renderControls(reduce(log.events, TOURNAMENT_ID));
    expect(closeButton()).toBeDisabled();
    expect(screen.getByText('1 of 2 results')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish tournament' })).not.toBeInTheDocument();
  });

  it('closes the round once every played match has a result', () => {
    const log = round1Open()
      .add('ResultReported', { matchId: matchId(1), result: WIN_A })
      .add('ResultReported', { matchId: matchId(2), result: WIN_A });
    const { dispatch } = renderControls(reduce(log.events, TOURNAMENT_ID));
    expect(screen.getByText('2 of 2 results')).toBeInTheDocument();

    fireEvent.click(closeButton());

    expect(dispatch).toHaveBeenCalledWith({ type: 'RoundClosed', payload: { round: 1 } });
  });

  it('offers Pair round 2 and Finish once round 1 is closed', () => {
    const log = swissHistory(playerIds(4), [
      [
        [a, b],
        [c, d],
      ],
    ]);
    renderControls(reduce(log.events, TOURNAMENT_ID));
    expect(pairButton(2)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Finish tournament' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Close round/ })).not.toBeInTheDocument();
  });
});

describe('RoundControls: Finish tournament', () => {
  const [a, b] = playerIds(2);
  const lastRoundDone = () =>
    reduce(
      swissHistory(playerIds(2), [[[a, b]]], { ...CREATED_PAYLOAD, swissRounds: 1 }).events,
      TOURNAMENT_ID,
    );
  const dialog = () => screen.getByRole('dialog', { name: 'Finish tournament' });

  it('is the only action after the last swiss round', () => {
    renderControls(lastRoundDone());
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Finish tournament',
    ]);
  });

  it('asks for confirmation, and Cancel dispatches nothing', () => {
    const { dispatch } = renderControls(lastRoundDone());
    fireEvent.click(screen.getByRole('button', { name: 'Finish tournament' }));
    expect(
      within(dialog()).getByText(
        `Finish ${CREATED_PAYLOAD.name}? Results can no longer be entered or changed.`,
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('dispatches TournamentFinished on Finish', () => {
    const { dispatch } = renderControls(lastRoundDone());
    fireEvent.click(screen.getByRole('button', { name: 'Finish tournament' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Finish' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'TournamentFinished', payload: {} });
  });

  it('is not offered in setup', () => {
    renderControls(reduce(registeredLog(2).events, TOURNAMENT_ID));
    expect(screen.queryByRole('button', { name: 'Finish tournament' })).not.toBeInTheDocument();
  });
});
