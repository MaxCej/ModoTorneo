import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import {
  err,
  execute,
  ok,
  reduce,
  type Command,
  type Player,
  type Result,
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
  uuid,
} from '../../domain/fixtures/builders';
import type { StorageError } from '../../storage';
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

type AddPlayer = (name: string) => Promise<Result<Player, StorageError>>;

/**
 * Holds the document and the registry. Commands go through `execute`, like the store does;
 * new players get ids `uuid(700)`, `uuid(701)`… unless `addPlayer` overrides the save.
 */
function renderPanel(initial: TournamentDocument, addPlayer?: AddPlayer) {
  const dispatched: Command[] = [];
  let current = initial;
  let registry = REGISTRY;
  let nextId = 700;

  function Harness() {
    const [doc, setDoc] = useState(initial);
    const [players, setPlayers] = useState(REGISTRY);
    const state = reduce(doc.events, doc.id);
    return (
      <RegistrationPanel
        state={state}
        players={players}
        playersError={null}
        onAddPlayer={async (name) => {
          if (addPlayer) {
            return addPlayer(name);
          }
          const player = { id: uuid(nextId++), name: name.trim(), createdAt: CREATED_AT };
          registry = [...registry, player].sort((a, b) => a.name.localeCompare(b.name, 'en'));
          setPlayers(registry);
          return ok(player);
        }}
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
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </MantineProvider>,
  );
  return { dispatched, doc: () => current, registry: () => registry };
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
    // Only the Deck button is left.
    expect(
      within(row)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Deck']);
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
  it('shows both lists with no inputs and only the Deck buttons', () => {
    const log = addClosedRound(registeredLog(4), 1, 'swiss', [
      pairing(1, 1, P1, P2),
      pairing(2, 2, P3, P4),
    ]).add('TournamentFinished', {});
    renderPanel(toDoc(log.events));

    expect(names(registryColumn())).toEqual(['Alice', 'Bruno']);
    expect(names(registeredColumn())).toHaveLength(4);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(
      Array(4).fill('Deck'),
    );
  });
});

describe('RegistrationPanel deck button', () => {
  const swissClosed = () =>
    addClosedRound(registeredLog(4), 1, 'swiss', [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)]);
  const docs = {
    setup: () => registeredLog(4),
    running: () => {
      const log = registeredLog(4).add('RoundPaired', {
        round: 1,
        stage: 'swiss',
        pairings: [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)],
      });
      return log.add('PlayerDropped', { playerId: P4 });
    },
    topCut: () => swissClosed().add('TopCutStarted', { size: 4 }),
    finished: () => swissClosed().add('TournamentFinished', {}),
  };

  it.each(Object.keys(docs) as (keyof typeof docs)[])(
    'shows a Deck button for every registered player while %s',
    (status) => {
      renderPanel(toDoc(docs[status]().events));
      for (const name of ['Player 1', 'Player 2', 'Player 3', 'Player 4']) {
        expect(
          registeredColumn().getByRole('button', { name: `Deck for ${name}` }),
        ).toBeInTheDocument();
      }
    },
  );

  it('shows the archetype under the name, and nothing without one', () => {
    const log = registeredLog(2).add('DeckSet', {
      playerId: P1,
      archetype: 'Burn',
      main: [],
      sideboard: [],
    });
    renderPanel(toDoc(log.events));

    const rows = registeredColumn().getAllByRole('listitem');
    expect(within(rows[0]).getByText('Burn')).toBeInTheDocument();
    expect(rows[0].firstChild?.textContent).toBe('Player 1Burn');
    expect(rows[1].firstChild?.textContent).toBe('Player 2');
  });

  it('opens the deck modal and saves through the dispatch', () => {
    const { dispatched } = renderPanel(toDoc(docs.running().events));

    fireEvent.click(screen.getByRole('button', { name: 'Deck for Player 4' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Deck · Player 4' }));
    fireEvent.change(dialog.getByRole('combobox', { name: 'Archetype' }), {
      target: { value: 'Burn' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));

    expect(dispatched.at(-1)).toEqual({
      type: 'SetDeck',
      payload: { playerId: P4, archetype: 'Burn', main: [], sideboard: [] },
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('RegistrationPanel profile links', () => {
  it('links registered registry players and the read-only registry, not guests', () => {
    const guest = PLAYERS[7];
    const log = registeredLog(2).add('PlayerRegistered', {
      playerId: guest,
      playerName: 'Visitor',
      guest: true,
    });
    addClosedRound(log, 1, 'swiss', [pairing(1, 1, P1, P2), pairing(2, 2, guest, null)]).add(
      'TournamentFinished',
      {},
    );
    renderPanel(toDoc(log.events));

    expect(registeredColumn().getByRole('link', { name: 'Player 1' })).toHaveAttribute(
      'href',
      `/players/${P1}`,
    );
    expect(registeredColumn().getByText('Visitor')).toBeInTheDocument();
    expect(registeredColumn().queryByRole('link', { name: 'Visitor' })).not.toBeInTheDocument();
    expect(registryColumn().getByRole('link', { name: 'Alice' })).toHaveAttribute(
      'href',
      `/players/${PLAYERS[4]}`,
    );
  });

  it('keeps registry names as register buttons in edit mode', () => {
    const { dispatched } = renderPanel(toDoc(logBuilder().events));
    expect(registryColumn().queryByRole('link')).not.toBeInTheDocument();

    fireEvent.click(registryColumn().getByRole('button', { name: 'Bruno' }));

    expect(dispatched).toHaveLength(1);
    expect(names(registeredColumn())).toEqual(['Bruno']);
  });
});

describe('RegistrationPanel name inputs', () => {
  const newPlayer = () => screen.getByRole('textbox', { name: 'New player' });
  const addGuest = () => screen.getByRole('textbox', { name: 'Add guest' });
  const type = (input: HTMLElement, value: string) =>
    fireEvent.change(input, { target: { value } });
  const enter = (input: HTMLElement) => fireEvent.keyDown(input, { key: 'Enter' });

  it('adds a new player to the registry and registers them', async () => {
    const { dispatched, registry } = renderPanel(toDoc(logBuilder().events));
    newPlayer().focus();
    type(newPlayer(), '  Carmen ');
    enter(newPlayer());

    await waitFor(() => expect(names(registeredColumn())).toEqual(['Carmen']));
    expect(registry().map((p) => p.name)).toContain('Carmen');
    expect(dispatched).toEqual([
      { type: 'PlayerRegistered', payload: { playerId: uuid(700), playerName: 'Carmen' } },
    ]);
    expect(newPlayer()).toHaveValue('');
    expect(newPlayer()).toHaveFocus();
  });

  it('shows a storage error under the input and registers nobody', async () => {
    const { dispatched } = renderPanel(toDoc(logBuilder().events), async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'blocked' },
    }));
    type(newPlayer(), 'Carmen');
    enter(newPlayer());

    expect(
      await screen.findByText('Could not add the player (UNAVAILABLE): blocked'),
    ).toBeInTheDocument();
    expect(dispatched).toEqual([]);
    expect(newPlayer()).toHaveValue('Carmen');
  });

  it('registers a guest with the badge, without touching the registry', async () => {
    const { dispatched, registry } = renderPanel(toDoc(logBuilder().events));
    addGuest().focus();
    type(addGuest(), 'Visitor');
    enter(addGuest());

    const row = registeredColumn().getByText('Visitor').closest('li')!;
    expect(within(row).getByText('Guest')).toBeInTheDocument();
    expect(dispatched).toMatchObject([
      { type: 'PlayerRegistered', payload: { playerName: 'Visitor', guest: true } },
    ]);
    expect(registry()).toEqual(REGISTRY);
    await waitFor(() => expect(addGuest()).toHaveValue(''));
    expect(addGuest()).toHaveFocus();
  });

  it('ignores Enter on an empty name', () => {
    const { dispatched } = renderPanel(toDoc(logBuilder().events));
    type(addGuest(), '   ');
    enter(addGuest());
    expect(dispatched).toEqual([]);
  });

  it.each([
    ['a registry player', 'alice'],
    ['a registered player', ' PLAYER 1 '],
  ])('needs a second Enter for the name of %s', async (_, name) => {
    const { dispatched } = renderPanel(toDoc(registeredLog(1).events));
    type(addGuest(), name);

    enter(addGuest());
    expect(screen.getByText(`A player named ${name.trim()} already exists.`)).toBeInTheDocument();
    expect(dispatched).toEqual([]);

    enter(addGuest());
    expect(dispatched).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText(/already exists/)).not.toBeInTheDocument());
  });

  it('adds a duplicate with "Add anyway" and gives the focus back', async () => {
    const { dispatched } = renderPanel(toDoc(logBuilder().events));
    type(newPlayer(), 'Bruno');
    enter(newPlayer());

    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }));

    await waitFor(() => expect(dispatched).toHaveLength(1));
    expect(names(registeredColumn())).toEqual(['Bruno']);
    expect(newPlayer()).toHaveFocus();
  });

  it('clears the warning when the text is edited', () => {
    const { dispatched } = renderPanel(toDoc(logBuilder().events));
    type(addGuest(), 'Bruno');
    enter(addGuest());
    expect(screen.getByText(/already exists/)).toBeInTheDocument();

    type(addGuest(), 'Bruno ');
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
    enter(addGuest());
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    expect(dispatched).toEqual([]);
  });

  it('keeps both inputs for late entries while running', () => {
    renderPanel(runningDoc(4));
    expect(newPlayer()).toBeInTheDocument();
    expect(addGuest()).toBeInTheDocument();
  });
});
