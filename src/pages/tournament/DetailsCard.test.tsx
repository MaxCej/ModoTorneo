import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
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
  addClosedRound,
  pairing,
  PLAYERS,
  registeredLog,
  runningDoc,
} from '../../domain/fixtures/builders';
import { DetailsCard } from './DetailsCard';

const [P1, P2, P3, P4] = PLAYERS;

type Dispatch = (cmd: Command) => Result<TournamentState, DomainError>;

function renderCard(state: TournamentState, onDispatch = vi.fn<Dispatch>(() => ok(state))) {
  render(
    <MantineProvider env="test">
      <DetailsCard state={state} onDispatch={onDispatch} />
    </MantineProvider>,
  );
  return onDispatch;
}

const setupState = (players = 4, swissRounds: number | null = null) =>
  reduce(registeredLog(players, { ...CREATED_PAYLOAD, swissRounds }).events, TOURNAMENT_ID);

const runningState = () => reduce(runningDoc(4).events, TOURNAMENT_ID);

const finishedState = () => {
  const log = addClosedRound(registeredLog(4), 1, 'swiss', [
    pairing(1, 1, P1, P2),
    pairing(2, 2, P3, P4),
  ]).add('TournamentFinished', {});
  return reduce(log.events, TOURNAMENT_ID);
};

const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
const save = () => screen.getByRole('button', { name: 'Save' });
const nameInput = () => screen.getByRole('textbox', { name: 'Name' });
const rowValue = (label: string) =>
  within(screen.getByRole('rowheader', { name: label }).closest('tr')!).getByRole('cell')
    .textContent;

describe('DetailsCard view', () => {
  it('shows the details', () => {
    renderCard(setupState(4, 3));
    expect(rowValue('Name')).toBe(CREATED_PAYLOAD.name);
    expect(rowValue('Date')).toBe(CREATED_PAYLOAD.date);
    expect(rowValue('Location')).toBe(CREATED_PAYLOAD.location);
    expect(rowValue('Format')).toBe('Modern');
    expect(rowValue('Status')).toBe('Setup');
    expect(rowValue('Swiss rounds')).toBe('3');
  });

  it('shows auto rounds from the active player count', () => {
    renderCard(setupState(5));
    expect(rowValue('Swiss rounds')).toBe('Auto (3 for 5 players)');
  });

  it('asks for at least 2 players while auto has no recommendation', () => {
    renderCard(setupState(1));
    expect(rowValue('Swiss rounds')).toBe('Auto (register at least 2 players)');
  });

  it('toggles the recommended rounds table and highlights the current row', () => {
    renderCard(setupState(5));
    const toggle = screen.getByRole('button', { name: 'Recommended rounds' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // jsdom has no layout, so the Collapse content stays out of the accessibility tree.
    const current = screen
      .getAllByRole('row', { hidden: true })
      .filter((row) => row.getAttribute('aria-current') === 'true');
    expect(current.map((row) => row.textContent)).toEqual(['5–83—']);
  });
});

describe('DetailsCard edit', () => {
  it('dispatches only the changed name', () => {
    const onDispatch = renderCard(setupState(4, 3));
    edit();
    fireEvent.change(nameInput(), { target: { value: 'Saturday Modern' } });
    fireEvent.click(save());

    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith<[Command]>({
      type: 'TournamentDetailsChanged',
      payload: { name: 'Saturday Modern' },
    });
    // Back to the view after an accepted change.
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument();
  });

  it('dispatches swissRounds null when switching to Auto', () => {
    const onDispatch = renderCard(setupState(4, 3));
    edit();
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    fireEvent.click(save());

    expect(onDispatch).toHaveBeenCalledWith({
      type: 'TournamentDetailsChanged',
      payload: { swissRounds: null },
    });
  });

  it('disables Save until a field changes, and when it is changed back', () => {
    renderCard(setupState());
    edit();
    expect(save()).toBeDisabled();

    fireEvent.change(nameInput(), { target: { value: 'Other' } });
    expect(save()).toBeEnabled();

    fireEvent.change(nameInput(), { target: { value: CREATED_PAYLOAD.name } });
    expect(save()).toBeDisabled();
  });

  it('discards the edit with Cancel', () => {
    const onDispatch = renderCard(setupState());
    edit();
    fireEvent.change(nameInput(), { target: { value: 'Other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDispatch).not.toHaveBeenCalled();
    expect(rowValue('Name')).toBe(CREATED_PAYLOAD.name);
    edit();
    expect(nameInput()).toHaveValue(CREATED_PAYLOAD.name);
  });

  it('stays in edit mode when the command is rejected', () => {
    const state = setupState();
    const onDispatch = vi.fn<Dispatch>(() => ({
      ok: false,
      error: { code: 'INVALID_DETAILS', message: 'no' },
    }));
    renderCard(state, onDispatch);
    edit();
    fireEvent.change(nameInput(), { target: { value: 'Other' } });
    fireEvent.click(save());

    expect(onDispatch).toHaveBeenCalled();
    expect(nameInput()).toHaveValue('Other');
  });

  it('enables every field in setup', () => {
    renderCard(setupState());
    edit();
    expect(nameInput()).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Format' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeEnabled();
  });

  it('disables the format and Auto while running', () => {
    renderCard(runningState());
    edit();
    expect(screen.getByRole('combobox', { name: 'Format' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeDisabled();
    expect(nameInput()).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Number of swiss rounds' })).toBeEnabled();
  });

  it('disables the format and swiss rounds once finished', () => {
    renderCard(finishedState());
    edit();
    expect(screen.getByRole('combobox', { name: 'Format' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Number of swiss rounds' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Location' })).toBeEnabled();
  });
});
