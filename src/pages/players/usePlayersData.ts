import { useEffect, useState } from 'react';
import type { Player } from '../../domain';
import { getStorage, type StorageError, type TournamentSummary } from '../../storage';
import { usePlayersStore } from '../../store/playersStore';

export type PlayersData =
  | { status: 'loading' }
  | { status: 'ready'; players: Player[]; tournaments: TournamentSummary[] }
  | { status: 'error'; error: StorageError };

/** The registry and every tournament summary, loaded on mount. Summaries only, no documents. */
export function usePlayersData(): PlayersData {
  const players = usePlayersStore((s) => s.players);
  const playersStatus = usePlayersStore((s) => s.status);
  const playersError = usePlayersStore((s) => s.error);
  const [list, setList] = useState<
    | { status: 'loading' }
    | { status: 'ready'; tournaments: TournamentSummary[] }
    | { status: 'error'; error: StorageError }
  >({ status: 'loading' });
  useEffect(() => {
    let active = true;
    // The store may hold players from an earlier page: the list is ready only after both loads.
    void Promise.all([usePlayersStore.getState().load(), getStorage().listTournaments()]).then(
      ([, result]) => {
        if (active) {
          setList(
            result.ok
              ? { status: 'ready', tournaments: result.value }
              : { status: 'error', error: result.error },
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (playersError !== null && playersStatus === 'error') {
    return { status: 'error', error: playersError };
  }
  if (list.status === 'error') {
    return list;
  }
  if (playersStatus !== 'ready' || list.status === 'loading') {
    return { status: 'loading' };
  }
  return { status: 'ready', players, tournaments: list.tournaments };
}
