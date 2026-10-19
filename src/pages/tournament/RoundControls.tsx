import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  activePlayerCount,
  pairSwissRound,
  redoPairingCommands,
  resolvedSwissRounds,
  type Command,
  type DomainError,
  type Result,
  type TournamentDocument,
  type TournamentState,
} from '../../domain';
import { FinishTournamentModal } from './FinishTournamentModal';
import { RedoPairingsModal } from './RedoPairingsModal';

type Props = {
  doc: TournamentDocument;
  state: TournamentState;
  onDispatch: (cmd: Command) => Result<TournamentState, DomainError>;
  onDispatchAll: (commands: [Command, ...Command[]]) => Result<TournamentState, DomainError>;
  /** Called with the round number after a round is paired and stored. */
  onPaired: (round: number) => void;
};

/** The round actions that apply right now, above the tabs. */
export function RoundControls({ doc, state, onDispatch, onDispatchAll, onPaired }: Props) {
  const { t } = useTranslation();
  const [pairError, setPairError] = useState<DomainError | null>(null);
  const [finishing, setFinishing] = useState(false);
  // The counts shown in the redo modal, taken when it opens.
  const [redoing, setRedoing] = useState<{ results: number; swaps: number } | null>(null);

  const current = state.rounds.at(-1);
  const openRound = current !== undefined && !current.closed ? current : null;
  const next = state.rounds.length + 1;
  const swissRounds = resolvedSwissRounds(state);
  const enoughPlayers = activePlayerCount(state) >= 2;
  const canPair =
    (state.status === 'setup' || state.status === 'running') &&
    openRound === null &&
    (swissRounds === null || next <= swissRounds);
  const canRedo = openRound !== null && openRound.stage === 'swiss';
  const canFinish = state.status === 'running' && openRound === null && state.rounds.length > 0;

  // Byes carry an implicit result, so only played matches count.
  const played = openRound?.matches.filter((match) => match.playerB !== null) ?? [];
  const reported = played.filter((match) => match.result !== null).length;

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

  function openRedo() {
    setPairError(null);
    const preview = redoPairingCommands(doc);
    setRedoing(
      preview.ok
        ? { results: preview.value.voidedResults, swaps: preview.value.voidedSwaps }
        : { results: 0, swaps: 0 },
    );
  }

  /** Builds the commands on the latest document, then appends them in one save. */
  function redo() {
    setRedoing(null);
    const plan = redoPairingCommands(doc);
    if (!plan.ok) {
      setPairError(plan.error);
      return;
    }
    if (onDispatchAll(plan.value.commands).ok) {
      onPaired(plan.value.round);
    }
  }

  if (!canPair && !canFinish && openRound === null && pairError === null) {
    return null;
  }

  return (
    <Stack gap="xs">
      <Group gap="sm">
        {canPair && (
          <>
            <Button onClick={pair} disabled={!enoughPlayers}>
              {t('tournament.rounds.pair', { round: next })}
            </Button>
            {!enoughPlayers && (
              <Text size="sm" c="dimmed">
                {t('tournament.rounds.needPlayers')}
              </Text>
            )}
          </>
        )}
        {openRound !== null && (
          <>
            <Button
              disabled={reported < played.length}
              onClick={() =>
                onDispatch({ type: 'RoundClosed', payload: { round: openRound.number } })
              }
            >
              {t('tournament.rounds.close', { round: openRound.number })}
            </Button>
            <Text size="sm" c="dimmed">
              {t('tournament.rounds.progress', { reported, total: played.length })}
            </Text>
          </>
        )}
        {canRedo && (
          <Button variant="light" onClick={openRedo}>
            {t('tournament.rounds.redo')}
          </Button>
        )}
        {canFinish && (
          <Button variant="light" onClick={() => setFinishing(true)}>
            {t('tournament.rounds.finish')}
          </Button>
        )}
      </Group>
      {pairError && (
        <Alert color="red">
          {t('tournament.rounds.pairFailed', {
            code: pairError.code,
            message: pairError.message,
          })}
        </Alert>
      )}
      {redoing !== null && openRound !== null && (
        <RedoPairingsModal
          round={openRound.number}
          voidedResults={redoing.results}
          voidedSwaps={redoing.swaps}
          onCancel={() => setRedoing(null)}
          onConfirm={redo}
        />
      )}
      {finishing && (
        <FinishTournamentModal
          tournamentName={state.name}
          onCancel={() => setFinishing(false)}
          onConfirm={() => {
            onDispatch({ type: 'TournamentFinished', payload: {} });
            setFinishing(false);
          }}
        />
      )}
    </Stack>
  );
}
