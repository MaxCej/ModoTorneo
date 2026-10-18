import { Card, SimpleGrid } from '@mantine/core';
import { useState } from 'react';
import type {
  Command,
  DomainError,
  Player,
  PlayerEntry,
  Result,
  TournamentState,
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
  onDispatch: (cmd: Command) => Result<TournamentState, DomainError>;
};

/** Same order as the registry: English collation, then id. */
const collator = new Intl.Collator('en');

/** Registry on the left, registered players on the right. Late entries and drops while running. */
export function RegistrationPanel({ state, players, playersError, onDispatch }: Props) {
  const [dropping, setDropping] = useState<PlayerEntry | null>(null);
  const readOnly = state.status === 'topCut' || state.status === 'finished';

  const available = players.filter((player) => !(player.id in state.players));
  const entries = Object.values(state.players).sort(
    (a, b) =>
      collator.compare(a.playerName, b.playerName) ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );

  return (
    <Card withBorder>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
        <RegistryList
          players={available}
          loadError={playersError}
          readOnly={readOnly}
          onRegister={(player) =>
            onDispatch({
              type: 'PlayerRegistered',
              payload: { playerId: player.id, playerName: player.name },
            })
          }
        />
        <RegisteredList
          entries={entries}
          status={state.status}
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
