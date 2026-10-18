import { Card, SimpleGrid } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  newId,
  type Command,
  type DomainError,
  type Player,
  type PlayerEntry,
  type Result,
  type TournamentState,
} from '../../domain';
import type { StorageError } from '../../storage';
import { DropPlayerModal } from './DropPlayerModal';
import { RegisteredList } from './RegisteredList';
import { RegistryList } from './RegistryList';

type Props = {
  state: TournamentState;
  /** The global registry, name asc. */
  players: Player[];
  playersError: StorageError | null;
  /** Saves a new registry player (`playersStore.addPlayer`). */
  onAddPlayer: (name: string) => Promise<Result<Player, StorageError>>;
  onDispatch: (cmd: Command) => Result<TournamentState, DomainError>;
};

/** Same order as the registry: English collation, then id. */
const collator = new Intl.Collator('en');

/** Registry on the left, registered players on the right. Late entries and drops while running. */
export function RegistrationPanel({
  state,
  players,
  playersError,
  onAddPlayer,
  onDispatch,
}: Props) {
  const { t } = useTranslation();
  const [dropping, setDropping] = useState<PlayerEntry | null>(null);
  const readOnly = state.status === 'topCut' || state.status === 'finished';

  const available = players.filter((player) => !(player.id in state.players));
  const entries = Object.values(state.players).sort(
    (a, b) =>
      collator.compare(a.playerName, b.playerName) ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );

  // The duplicate warning checks both lists.
  const existingNames = [
    ...players.map((player) => player.name),
    ...entries.map((entry) => entry.playerName),
  ];

  const register = (player: Player) =>
    onDispatch({
      type: 'PlayerRegistered',
      payload: { playerId: player.id, playerName: player.name },
    });

  /** Registry first: a storage error registers nobody. */
  async function addNew(name: string): Promise<string | null> {
    const added = await onAddPlayer(name);
    if (!added.ok) {
      return t('tournament.registration.addFailed', {
        code: added.error.code,
        message: added.error.message,
      });
    }
    register(added.value);
    return null;
  }

  function addGuest(name: string): string | null {
    const result = onDispatch({
      type: 'PlayerRegistered',
      payload: { playerId: newId(), playerName: name, guest: true },
    });
    // A rejected command shows under the panel; keep the typed name.
    return result.ok ? null : '';
  }

  return (
    <Card withBorder>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
        <RegistryList
          players={available}
          loadError={playersError}
          readOnly={readOnly}
          existingNames={existingNames}
          onRegister={register}
          onAddNew={addNew}
        />
        <RegisteredList
          entries={entries}
          status={state.status}
          existingNames={existingNames}
          onAddGuest={addGuest}
          onRemove={(entry) =>
            onDispatch({ type: 'PlayerUnregistered', payload: { playerId: entry.playerId } })
          }
          onDrop={setDropping}
        />
      </SimpleGrid>

      {dropping && (
        <DropPlayerModal
          playerName={dropping.playerName}
          onCancel={() => setDropping(null)}
          onConfirm={() => {
            onDispatch({ type: 'PlayerDropped', payload: { playerId: dropping.playerId } });
            setDropping(null);
          }}
        />
      )}
    </Card>
  );
}
