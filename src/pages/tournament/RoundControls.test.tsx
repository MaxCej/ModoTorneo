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
  type TournamentDocument,
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
type DispatchAll = (commands: [Command, ...Command[]]) => Result<TournamentState, DomainError>;

/** `doc` is only read by "Redo pairings"; tests of other actions pass the state alone. */
function renderControls(
  state: TournamentState,
  onDispatch?: Dispatch,
  doc: TournamentDocument = { schemaVersion: 1, id: TOURNAMENT_ID, events: [] },
  onDispatchAll?: DispatchAll,
) {
  const dispatch = vi.fn<Dispatch>(onDispatch ?? (() => ok(state)));
  const dispatchAll = vi.fn<DispatchAll>(onDispatchAll ?? (() => ok(state)));
  const onPaired = vi.fn();
  render(
    <MantineProvider env="test">
      <RoundControls
        doc={doc}
        state={state}
        onDispatch={dispatch}
        onDispatchAll={dispatchAll}
        onPaired={onPaired}
      />
    </MantineProvider>,
  );
  return { dispatch, dispatchAll, onPaired };
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

describe('RoundControls: Redo pairings', () => {
  const [a, b, c, d, e] = playerIds(5);
  const redoButton = () => screen.queryByRole('button', { name: 'Redo pairings' });
  const dialog = () => screen.getByRole('dialog', { name: 'Redo pairings for round 2?' });

  /** Round 1 closed (a-b, c-d), round 2 open as matches 3 (a-c) and 4 (b-d). */
  const round2Open = () =>
    swissHistory(playerIds(4), [
      [
        [a, b],
        [c, d],
      ],
    ]).add('RoundPaired', {
      round: 2,
      stage: 'swiss',
      pairings: [pairing(3, 1, a, c), pairing(4, 2, b, d)],
    });

  function renderRedo(log: ReturnType<typeof round2Open>, onDispatchAll?: DispatchAll) {
    const doc: TournamentDocument = { schemaVersion: 1, id: TOURNAMENT_ID, events: log.events };
    return renderControls(reduce(log.events, TOURNAMENT_ID), undefined, doc, onDispatchAll);
  }

  it('is shown only while a swiss round is open', () => {
    const cases: [string, ReturnType<typeof round2Open>, boolean][] = [
      ['setup', registeredLog(4), false],
      ['open swiss round', round2Open(), true],
      [
        'closed round',
        swissHistory(playerIds(4), [
          [
            [a, b],
            [c, d],
          ],
        ]),
        false,
      ],
      [
        'open top cut round',
        swissHistory(
          playerIds(4),
          [
            [
              [a, b],
              [c, d],
            ],
          ],
          { ...CREATED_PAYLOAD, swissRounds: 1 },
        )
          .add('TopCutStarted', { size: 4 })
          .add('RoundPaired', {
            round: 2,
            stage: 'topCut',
            pairings: [pairing(3, 1, a, d), pairing(4, 2, c, b)],
          }),
        false,
      ],
    ];
    for (const [name, log, shown] of cases) {
      const view = render(
        <MantineProvider env="test">
          <RoundControls
            doc={{ schemaVersion: 1, id: TOURNAMENT_ID, events: log.events }}
            state={reduce(log.events, TOURNAMENT_ID)}
            onDispatch={vi.fn()}
            onDispatchAll={vi.fn()}
            onPaired={vi.fn()}
          />
        </MantineProvider>,
      );
      expect(redoButton() !== null, name).toBe(shown);
      view.unmount();
    }
  });

  it('shows the results and swaps to be undone, and Cancel dispatches nothing', () => {
    const log = round2Open()
      .add('PlayersSwapped', { round: 2, playerA: c, playerB: b })
      .add('ResultReported', { matchId: matchId(3), result: WIN_A });
    const { dispatchAll } = renderRedo(log);

    fireEvent.click(redoButton()!);

    expect(
      within(dialog()).getByText('This undoes 1 result and 1 swap of this round.'),
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByText(
        'Drops, registrations and detail changes made during the round are kept.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(dispatchAll).not.toHaveBeenCalled();
  });

  it('omits the undo line when nothing of the round is undone', () => {
    renderRedo(round2Open());
    fireEvent.click(redoButton()!);
    expect(within(dialog()).queryByText(/This undoes/)).not.toBeInTheDocument();
  });

  it('dispatches every command at once on Redo and reports the round', () => {
    const log = round2Open()
      .add('ResultReported', { matchId: matchId(3), result: WIN_A })
      .add('PlayerRegistered', { playerId: e, playerName: 'Late' });
    const { dispatchAll, dispatch, onPaired } = renderRedo(log);

    fireEvent.click(redoButton()!);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Redo' }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(dispatchAll).toHaveBeenCalledTimes(1);
    const [commands] = dispatchAll.mock.calls[0];
    expect(commands.map((cmd) => cmd.type)).toEqual([
      'RolledBack',
      'PlayerRegistered',
      'RoundPaired',
    ]);
    expect(onPaired).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the pairFailed alert and dispatches nothing when pairing fails', () => {
    // Two players, one drops during round 1: one active player cannot be paired.
    const [p, q] = playerIds(2);
    const log = registeredLog(2)
      .add('RoundPaired', { round: 1, stage: 'swiss', pairings: [pairing(1, 1, p, q)] })
      .add('PlayerDropped', { playerId: q });
    const { dispatchAll } = renderRedo(log);

    fireEvent.click(redoButton()!);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Redo pairings for round 1?' })).getByRole(
        'button',
        { name: 'Redo' },
      ),
    );

    expect(dispatchAll).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/^Could not pair the round \(/)).toBeInTheDocument();
  });
});

describe('RoundControls: top cut', () => {
  const ids = playerIds(8);
  const startButton = () => screen.queryByRole('button', { name: 'Start top cut' });
  const buttons = () => screen.getAllByRole('button').map((button) => button.textContent);

  /** 8 players (or `count`), one closed swiss round of three: 1 v 2, 3 v 4… */
  const swissDone = (count = 8) =>
    swissHistory(
      playerIds(count),
      [
        Array.from(
          { length: count / 2 },
          (_, i) => [ids[2 * i], ids[2 * i + 1]] as [string, string],
        ),
      ],
      { ...CREATED_PAYLOAD, swissRounds: 3 },
    );
  const docOf = (log: ReturnType<typeof swissDone>): TournamentDocument => ({
    schemaVersion: 1,
    id: TOURNAMENT_ID,
    events: log.events,
  });

  it('offers Start top cut in running with no open round and at least 4 active players', () => {
    renderControls(reduce(swissDone().events, TOURNAMENT_ID));
    expect(buttons()).toEqual(['Pair round 2', 'Start top cut', 'Finish tournament']);
  });

  it.each([
    ['in setup', () => registeredLog(8)],
    ['with 2 active players', () => swissDone(2)],
    [
      'with a round open',
      () =>
        swissDone().add('RoundPaired', {
          round: 2,
          stage: 'swiss',
          pairings: [
            pairing(10, 1, ids[0], ids[2]),
            pairing(11, 2, ids[1], ids[3]),
            pairing(12, 3, ids[4], ids[6]),
            pairing(13, 4, ids[5], ids[7]),
          ],
        }),
    ],
    ['in the top cut', () => swissDone().add('TopCutStarted', { size: 4 })],
    ['when finished', () => swissDone().add('TournamentFinished', {})],
  ])('hides Start top cut %s', (_, build) => {
    renderControls(reduce(build().events, TOURNAMENT_ID));
    expect(startButton()).not.toBeInTheDocument();
  });

  it('hides Start top cut with 3 active players', () => {
    const log = swissDone(4).add('PlayerDropped', { playerId: ids[3] });
    renderControls(reduce(log.events, TOURNAMENT_ID));
    expect(startButton()).not.toBeInTheDocument();
  });

  it('starts and pairs the top cut in one dispatchAll and reports the first top cut round', () => {
    const log = swissDone();
    const { dispatch, dispatchAll, onPaired } = renderControls(
      reduce(log.events, TOURNAMENT_ID),
      undefined,
      docOf(log),
    );

    fireEvent.click(startButton()!);
    const dialog = within(screen.getByRole('dialog', { name: 'Start top cut' }));
    fireEvent.click(dialog.getByText('Best of 5'));
    fireEvent.click(dialog.getByRole('button', { name: 'Start top cut' }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(dispatchAll).toHaveBeenCalledTimes(1);
    const [commands] = dispatchAll.mock.calls[0];
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual({ type: 'TopCutStarted', payload: { size: 4, bestOf: 5 } });
    expect(commands[1]).toMatchObject({
      type: 'RoundPaired',
      payload: { round: 2, stage: 'topCut' },
    });
    expect(onPaired).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /** Top 4 of `swissDone`: semifinals (round 2) closed, players 1 and 3 win. */
  const semisDone = () => {
    const log = swissDone().add('TopCutStarted', { size: 4 });
    log.add('RoundPaired', {
      round: 2,
      stage: 'topCut',
      pairings: [pairing(20, 1, ids[0], ids[6]), pairing(21, 2, ids[2], ids[4])],
    });
    log.add('ResultReported', { matchId: matchId(20), result: WIN_A });
    log.add('ResultReported', { matchId: matchId(21), result: WIN_A });
    return log.add('RoundClosed', { round: 2 });
  };

  it('pairs the final after the semifinals close', () => {
    const { dispatch, onPaired } = renderControls(reduce(semisDone().events, TOURNAMENT_ID));
    expect(buttons()).toEqual(['Pair round 3', 'Finish tournament']);

    fireEvent.click(pairButton(3)!);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'RoundPaired',
      payload: { round: 3, stage: 'topCut', pairings: [{ playerA: ids[0], playerB: ids[2] }] },
    });
    expect(onPaired).toHaveBeenCalledWith(3);
  });

  it('offers only Finish tournament after the final closes', () => {
    const log = semisDone().add('RoundPaired', {
      round: 3,
      stage: 'topCut',
      pairings: [pairing(22, 1, ids[0], ids[2])],
    });
    log.add('ResultReported', { matchId: matchId(22), result: WIN_A });
    log.add('RoundClosed', { round: 3 });
    renderControls(reduce(log.events, TOURNAMENT_ID));
    expect(buttons()).toEqual(['Finish tournament']);
  });

  it('pairs the first top cut round when the top cut has none (after a rollback)', () => {
    const log = swissDone().add('TopCutStarted', { size: 4 });
    const { dispatch } = renderControls(reduce(log.events, TOURNAMENT_ID));
    fireEvent.click(pairButton(2)!);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: 'RoundPaired',
      payload: { round: 2, stage: 'topCut' },
    });
  });
});
