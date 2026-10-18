import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  activePlayerCount,
  pairSwissRound,
  resolvedSwissRounds,
  type Command,
  type DomainError,
  type Result,
  type TournamentState,
} from '../../domain';

type Props = {
  state: TournamentState;
  onDispatch: (cmd: Command) => Result<TournamentState, DomainError>;
  /** Called with the round number after a round is paired and stored. */
  onPaired: (round: number) => void;
};

/** The round actions that apply right now, above the tabs. */
export function RoundControls({ state, onDispatch, onPaired }: Props) {
  const { t } = useTranslation();
  const [pairError, setPairError] = useState<DomainError | null>(null);

  const current = state.rounds.at(-1);
  const roundOpen = current !== undefined && !current.closed;
  const next = state.rounds.length + 1;
  const swissRounds = resolvedSwissRounds(state);
  const enoughPlayers = activePlayerCount(state) >= 2;
  const canPair =
    (state.status === 'setup' || state.status === 'running') &&
    !roundOpen &&
    (swissRounds === null || next <= swissRounds);

  function pair() {
    setPairError(null);
    const paired = pairSwissRound(state);
    if (!paired.ok) {
      setPairError(paired.error);
      return;
    }
    if (onDispatch({ type: 'RoundPaired', payload: paired.value }).ok) {
      onPaired(paired.value.round);
    }
  }

  if (!canPair && pairError === null) {
    return null;
  }

  return (
    <Stack gap="xs">
      {canPair && (
        <Group gap="sm">
          <Button onClick={pair} disabled={!enoughPlayers}>
            {t('tournament.rounds.pair', { round: next })}
          </Button>
          {!enoughPlayers && (
            <Text size="sm" c="dimmed">
              {t('tournament.rounds.needPlayers')}
            </Text>
          )}
        </Group>
      )}
      {pairError && (
        <Alert color="red">
          {t('tournament.rounds.pairFailed', {
            code: pairError.code,
            message: pairError.message,
          })}
        </Alert>
      )}
    </Stack>
  );
}
