import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  err,
  execute,
  ok,
  reduce,
  type Command,
  type Format,
  type TournamentDocument,
} from '../../domain';
import { PLAYERS, TOURNAMENT_ID, registeredLog, uuid } from '../../domain/fixtures/builders';
import type { StorageBackend, TournamentSummary } from '../../storage';
import { DeckModal } from './DeckModal';

const [P1, P2] = PLAYERS;

const mocks = vi.hoisted(() => ({
  listTournaments: null as StorageBackend['listTournaments'] | null,
}));

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>();
  return {
    ...actual,
    getStorage: () => ({ listTournaments: () => mocks.listTournaments!() }),
  };
});

/** A stored summary with only the fields suggestions read. */
const summary = (n: number, format: Format, archetypes: string[]) =>
  ({ id: uuid(800 + n), format, archetypes }) as unknown as TournamentSummary;

const SUMMARIES = [
  summary(1, 'modern', ['Izzet Prowess', 'Burn']),
  summary(2, 'legacy', ['Doomsday']),
];

beforeEach(() => {
  mocks.listTournaments = () => Promise.resolve(ok(SUMMARIES));
});

const MOXFIELD = [
  '4 Lightning Bolt (2X2) 117',
  '4 Monastery Swiftspear (BRO) 144 *F*',
  'oops',
  '',
  'SIDEBOARD:',
  '2 Spell Pierce (NEO) 72',
].join('\n');

/** The modal for P1 of a 2-player setup tournament, with commands run through `execute`. */
function renderModal(initial: TournamentDocument = docWith()) {
  const dispatched: Command[] = [];
  let current = initial;
  const onClose = vi.fn();

  function Harness() {
    const [doc, setDoc] = useState(initial);
    const state = reduce(doc.events, doc.id);
    return (
      <DeckModal
        state={state}
        entry={state.players[P1]}
        onClose={onClose}
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
  return { dispatched, onClose, doc: () => current };
}

function docWith(build: (log: ReturnType<typeof registeredLog>) => void = () => {}) {
  const log = registeredLog(2);
  build(log);
  return { schemaVersion: 1 as const, id: TOURNAMENT_ID, events: log.events };
}

const dialog = () => within(screen.getByRole('dialog', { name: 'Deck · Player 1' }));
const archetypeInput = () => dialog().getByRole('combobox', { name: 'Archetype' });
const decklist = () => dialog().getByRole('textbox', { name: 'Decklist' });
const saveButton = () => dialog().getByRole('button', { name: 'Save' });
const listItems = (name: RegExp) =>
  within(dialog().getByRole('list', { name }))
    .queryAllByRole('listitem')
    .map((item) => item.textContent);

describe('DeckModal', () => {
  it('suggests archetypes from tournaments of the same format only', async () => {
    renderModal();

    // "o" matches both Izzet Prowess (modern) and Doomsday (legacy).
    fireEvent.change(archetypeInput(), { target: { value: 'o' } });
    expect(await screen.findByRole('option', { name: 'Izzet Prowess' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Doomsday' })).not.toBeInTheDocument();
  });

  it('suggests archetypes of the current tournament', async () => {
    const doc = docWith((log) =>
      log.add('DeckSet', { playerId: P2, archetype: 'Amulet Titan', main: [], sideboard: [] }),
    );
    renderModal(doc);

    fireEvent.change(archetypeInput(), { target: { value: 'a' } });
    expect(await screen.findByRole('option', { name: 'Amulet Titan' })).toBeInTheDocument();
  });

  it("stores a suggested archetype with the suggestion's spelling", async () => {
    const { dispatched, onClose } = renderModal();
    fireEvent.change(archetypeInput(), { target: { value: 'i' } });
    await screen.findByRole('option', { name: 'Izzet Prowess' });

    fireEvent.change(archetypeInput(), { target: { value: ' izzet prowess ' } });
    fireEvent.click(saveButton());

    expect(dispatched).toEqual([
      {
        type: 'SetDeck',
        payload: { playerId: P1, archetype: 'Izzet Prowess', main: [], sideboard: [] },
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('previews a pasted list with counts and unparsed lines, and saves the parsed lists', () => {
    const { dispatched, doc } = renderModal();

    fireEvent.change(decklist(), { target: { value: MOXFIELD } });

    expect(dialog().getByText('Main deck (8)')).toBeInTheDocument();
    expect(dialog().getByText('Sideboard (2)')).toBeInTheDocument();
    expect(listItems(/^Main deck/)).toEqual(['4 Lightning Bolt', '4 Monastery Swiftspear']);
    expect(listItems(/^Sideboard/)).toEqual(['2 Spell Pierce']);
    expect(dialog().getByText('1 line was not read:')).toBeInTheDocument();
    expect(dialog().getByText('Line 3: oops')).toBeInTheDocument();

    fireEvent.click(saveButton());

    expect(dispatched).toEqual([
      {
        type: 'SetDeck',
        payload: {
          playerId: P1,
          main: [
            { quantity: 4, name: 'Lightning Bolt' },
            { quantity: 4, name: 'Monastery Swiftspear' },
          ],
          sideboard: [{ quantity: 2, name: 'Spell Pierce' }],
        },
      },
    ]);
    expect(reduce(doc().events, TOURNAMENT_ID).players[P1].deck?.main).toHaveLength(2);
  });

  it('warns about a capped quantity', () => {
    renderModal();
    fireEvent.change(decklist(), { target: { value: '60 Relentless Rats\n60 Relentless Rats' } });
    expect(dialog().getByText('Relentless Rats: quantity capped at 99.')).toBeInTheDocument();
  });

  it('shows the stored deck when reopened, and clears it', () => {
    const doc = docWith((log) =>
      log.add('DeckSet', {
        playerId: P1,
        archetype: 'Burn',
        main: [{ quantity: 4, name: 'Lightning Bolt' }],
        sideboard: [{ quantity: 2, name: 'Path to Exile' }],
      }),
    );
    const { dispatched, onClose } = renderModal(doc);

    expect(archetypeInput()).toHaveValue('Burn');
    expect(decklist()).toHaveValue('4 Lightning Bolt\n\nSideboard\n2 Path to Exile');
    expect(saveButton()).toBeDisabled();

    fireEvent.click(dialog().getByRole('button', { name: 'Clear deck' }));

    expect(dispatched).toEqual([
      { type: 'SetDeck', payload: { playerId: P1, main: [], sideboard: [] } },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('disables Save with no change and hides Clear deck without a deck', () => {
    renderModal();
    expect(saveButton()).toBeDisabled();
    expect(dialog().queryByRole('button', { name: 'Clear deck' })).not.toBeInTheDocument();

    fireEvent.change(archetypeInput(), { target: { value: 'Burn' } });
    expect(saveButton()).toBeEnabled();
    fireEvent.change(archetypeInput(), { target: { value: '  ' } });
    expect(saveButton()).toBeDisabled();
  });

  it('keeps the modal open and shows a dispatch error', () => {
    const doc = docWith();
    const { onClose } = renderModal(doc);
    fireEvent.change(archetypeInput(), { target: { value: 'Burn' } });
    // P1 leaves the log behind the modal's back, so SetDeck fails with UNKNOWN_PLAYER.
    doc.events.push({
      id: uuid(9999),
      seq: doc.events.length + 1,
      at: doc.events[0].at,
      type: 'PlayerUnregistered',
      payload: { playerId: P1 },
    });

    fireEvent.click(saveButton());

    expect(dialog().getByText(/^UNKNOWN_PLAYER: /)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays usable when the suggestions fail to load', async () => {
    mocks.listTournaments = () => Promise.reject(new Error('offline'));
    const { dispatched } = renderModal();

    fireEvent.change(archetypeInput(), { target: { value: 'Living End' } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(dispatched).toEqual([
        {
          type: 'SetDeck',
          payload: { playerId: P1, archetype: 'Living End', main: [], sideboard: [] },
        },
      ]),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
