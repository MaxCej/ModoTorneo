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
  type Player,
  type TournamentDocument,
  type TournamentEvent,
} from '../../domain';
import {
  PLAYERS,
  TOURNAMENT_ID,
  addClosedRound,
  logBuilder,
  pairing,
  registeredLog,
  runningDoc,
} from '../../domain/fixtures/builders';
import { RegistrationPanel } from './RegistrationPanel';

const [P1, P2, P3, P4] = PLAYERS;
const CREATED_AT = '2026-10-11T18:00:00.000Z';

/** Registry players named like `registeredLog` names them, plus two who are not registered. */
const REGISTRY: Player[] = [
  { id: P1, name: 'Player 1', createdAt: CREATED_AT },
  { id: P2, name: 'Player 2', createdAt: CREATED_AT },
  { id: P3, name: 'Player 3', createdAt: CREATED_AT },
  { id: P4, name: 'Player 4', createdAt: CREATED_AT },
  { id: PLAYERS[5], name: 'Bruno', createdAt: CREATED_AT },
  { id: PLAYERS[4], name: 'Alice', createdAt: CREATED_AT },
].sort((a, b) => a.name.localeCompare(b.name, 'en'));

const toDoc = (events: TournamentEvent[]): TournamentDocument => ({
  schemaVersion: 1,
  id: TOURNAMENT_ID,
  events,
});

/** Holds the document and applies each command with `execute`, like the store does. */
function renderPanel(initial: TournamentDocument) {
  const dispatched: Command[] = [];
  let current = initial;

  function Harness() {
    const [doc, setDoc] = useState(initial);
    const state = reduce(doc.events, doc.id);
    return (
      <RegistrationPanel
        state={state}
        players={REGISTRY}
        playersError={null}
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

const registryColumn = () =>
  within(screen.getByRole('heading', { name: 'Players' }).parentElement!);
const registeredColumn = () =>
  within(screen.getByRole('heading', { name: /^Registered \(\d+\)$/ }).parentElement!);
const names = (column: ReturnType<typeof registryColumn>) =>
  column.queryAllByRole('listitem').map((item) => item.firstChild?.textContent);

describe('RegistrationPanel in setup', () => {
  it('lists registry players on the left and nobody on the right', () => {
    renderPanel(toDoc(logBuilder().events));
    expect(names(registryColumn())).toEqual([
      'Alice',
      'Bruno',
      'Player 1',
      'Player 2',
      'Player 3',
      'Player 4',
    ]);
    expect(screen.getByRole('heading', { name: 'Registered (0)' })).toBeInTheDocument();
    expect(registeredColumn().getByText('No players registered yet.')).toBeInTheDocument();
  });

  it('moves a player right when the row is clicked', () => {
    const { dispatched } = renderPanel(toDoc(logBuilder().events));

    fireEvent.click(registryColumn().getByRole('button', { name: 'Alice' }));

    expect(dispatched).toEqual([
      { type: 'PlayerRegistered', payload: { playerId: PLAYERS[4], playerName: 'Alice' } },
    ]);
    expect(names(registryColumn())).not.toContain('Alice');
    expect(names(registeredColumn())).toEqual(['Alice']);
    expect(screen.getByRole('heading', { name: 'Registered (1)' })).toBeInTheDocument();
  });

  it('moves a player right with the Add button', () => {
    renderPanel(toDoc(logBuilder().events));
    fireEvent.click(screen.getByRole('button', { name: 'Add Bruno' }));
    expect(names(registeredColumn())).toEqual(['Bruno']);
  });

  it('filters by a case-insensitive substring', () => {
    renderPanel(toDoc(logBuilder().events));
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter' }), {
      target: { value: 'PLAYER 3' },
    });
    expect(names(registryColumn())).toEqual(['Player 3']);

    fireEvent.change(screen.getByRole('textbox', { name: 'Filter' }), {
      target: { value: 'zzz' },
    });
    expect(registryColumn().getByText('No player matches the filter.')).toBeInTheDocument();
  });

  it('registers the first listed player on Enter in the filter and clears it', () => {
    const { dispatched } = renderPanel(toDoc(logBuilder().events));
    const filter = screen.getByRole('textbox', { name: 'Filter' });
    fireEvent.change(filter, { target: { value: 'pla' } });

    fireEvent.keyDown(filter, { key: 'Enter' });

    expect(dispatched).toHaveLength(1);
    expect(names(registeredColumn())).toEqual(['Player 1']);
    expect(filter).toHaveValue('');
  });

  it('does nothing on Enter when no player matches', () => {
    const { dispatched } = renderPanel(toDoc(logBuilder().events));
    const filter = screen.getByRole('textbox', { name: 'Filter' });
    fireEvent.change(filter, { target: { value: 'zzz' } });
    fireEvent.keyDown(filter, { key: 'Enter' });
    expect(dispatched).toEqual([]);
    expect(filter).toHaveValue('zzz');
  });

  it('moves a registry player back to the left with Remove', () => {
    const { dispatched, doc } = renderPanel(toDoc(registeredLog(2).events));

    fireEvent.click(screen.getByRole('button', { name: 'Remove Player 1' }));

    expect(dispatched).toEqual([{ type: 'PlayerUnregistered', payload: { playerId: P1 } }]);
    expect(names(registeredColumn())).toEqual(['Player 2']);
    expect(names(registryColumn())).toContain('Player 1');
    expect(doc().events.at(-1)?.type).toBe('PlayerUnregistered');
  });

  it('removes a guest, who disappears', () => {
    const guest = PLAYERS[7];
    const log = logBuilder().add('PlayerRegistered', {
      playerId: guest,
      playerName: 'Visitor',
      guest: true,
    });
    renderPanel(toDoc(log.events));
    expect(registeredColumn().getByText('Guest')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Visitor' }));

    expect(screen.queryByText('Visitor')).not.toBeInTheDocument();
  });

  it('offers no Drop button in setup', () => {
    renderPanel(toDoc(registeredLog(2).events));
    expect(screen.queryByRole('button', { name: /^Drop/ })).not.toBeInTheDocument();
  });
});

describe('RegistrationPanel while running', () => {
  it('offers Drop instead of Remove', () => {
    renderPanel(runningDoc(4));
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Drop Player/ })).toHaveLength(4);
  });

  it('opens the drop modal, and Cancel dispatches nothing', () => {
    const { dispatched } = renderPanel(runningDoc(4));

    fireEvent.click(screen.getByRole('button', { name: 'Drop Player 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Drop player' });
    expect(
      within(dialog).getByText('Drop Player 1? They will not be paired in later rounds.'),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(dispatched).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the row with the Dropped badge after confirming', () => {
    const { dispatched } = renderPanel(runningDoc(4));

    fireEvent.click(screen.getByRole('button', { name: 'Drop Player 2' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Drop player' })).getByRole('button', {
        name: 'Drop',
      }),
    );

    expect(dispatched).toEqual([{ type: 'PlayerDropped', payload: { playerId: P2 } }]);
    const row = registeredColumn().getByText('Player 2').closest('li')!;
    expect(within(row).getByText('Dropped')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    // N counts only players who have not dropped.
    expect(screen.getByRole('heading', { name: 'Registered (3)' })).toBeInTheDocument();
  });

  it('registers a late entry from the left list', () => {
    const { doc } = renderPanel(runningDoc(4));
    fireEvent.click(screen.getByRole('button', { name: 'Add Alice' }));

    expect(names(registeredColumn())).toContain('Alice');
    expect(reduce(doc().events, TOURNAMENT_ID).players[PLAYERS[4]].registeredAtRound).toBe(1);
  });
});

describe('RegistrationPanel when finished', () => {
  it('shows both lists with no inputs and no buttons', () => {
    const log = addClosedRound(registeredLog(4), 1, 'swiss', [
      pairing(1, 1, P1, P2),
      pairing(2, 2, P3, P4),
    ]).add('TournamentFinished', {});
    renderPanel(toDoc(log.events));

    expect(names(registryColumn())).toEqual(['Alice', 'Bruno']);
    expect(names(registeredColumn())).toHaveLength(4);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
