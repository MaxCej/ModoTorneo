import {
  Alert,
  Anchor,
  Center,
  Container,
  Group,
  Loader,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { Command, TournamentState } from '../domain';
import { usePlayersStore } from '../store/playersStore';
import { useTournamentStore, type SaveNotice } from '../store/tournamentStore';
import { DetailsCard } from './tournament/DetailsCard';
import { RegistrationPanel } from './tournament/RegistrationPanel';
import { RoundControls } from './tournament/RoundControls';
import { RoundPanel } from './tournament/RoundPanel';
import { StandingsPanel } from './tournament/StandingsPanel';

/** The panel whose command was rejected last, so its error shows under it. */
type Panel = 'details' | 'registration' | 'rounds' | 'round';

const PLAYERS_TAB = 'players';
const STANDINGS_TAB = 'standings';
const roundTab = (round: number) => `round-${round}`;

/** The open round, else the last round, else "Players". */
function defaultTab(state: TournamentState): string {
  const open = state.rounds.find((round) => !round.closed);
  const last = state.rounds.at(-1);
  return open ? roundTab(open.number) : last ? roundTab(last.number) : PLAYERS_TAB;
}

export function TournamentPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const status = useTournamentStore((s) => s.status);
  const state = useTournamentStore((s) => s.state);
  const loadError = useTournamentStore((s) => s.loadError);
  const commandError = useTournamentStore((s) => s.commandError);
  const notice = useTournamentStore((s) => s.notice);
  const saving = useTournamentStore((s) => s.saving);
  const players = usePlayersStore((s) => s.players);
  const playersError = usePlayersStore((s) => s.error);
  const [errorPanel, setErrorPanel] = useState<Panel | null>(null);
  // The tab the organizer picked, for this tournament only. Until then the default follows
  // the rounds.
  const [selection, setSelection] = useState<{ id: string; tab: string } | null>(null);
  const selectedTab = selection !== null && selection.id === id ? selection.tab : null;
  const selectTab = (tab: string | null) => {
    if (tab !== null && id !== undefined) {
      setSelection({ id, tab });
    }
  };

  useEffect(() => {
    if (id !== undefined) {
      void useTournamentStore.getState().load(id);
      void usePlayersStore.getState().load();
    }
  }, [id]);

  function dispatchFrom(panel: Panel) {
    return (cmd: Command) => {
      setErrorPanel(panel);
      return useTournamentStore.getState().dispatch(cmd);
    };
  }

  // `id` guards against showing the previous tournament while the next one loads.
  const loaded = status === 'ready' && state !== null && state.id === id;

  if (status === 'error' && loadError?.code === 'NOT_FOUND') {
    return (
      <Container py="xl">
        <Stack>
          <Text>{t('tournament.notFound')}</Text>
          <Anchor component={Link} to="/">
            {t('tournament.backToList')}
          </Anchor>
        </Stack>
      </Container>
    );
  }

  return (
    <Container py="xl">
      <Stack>
        {notice && <NoticeAlert notice={notice} />}
        {status === 'error' && loadError && loadError.code !== 'NOT_FOUND' && (
          <Alert color="red">
            {t('tournament.loadFailed', { code: loadError.code, message: loadError.message })}
          </Alert>
        )}

        {!loaded && status !== 'error' && (
          <Center py="xl">
            <Loader aria-label={t('app.loading')} />
          </Center>
        )}

        {loaded && (
          <>
            <Group justify="space-between" align="baseline">
              <Title order={1}>{state.name}</Title>
              <Text size="sm" c="dimmed" aria-live="polite">
                {saving ? t('tournament.saving') : t('tournament.saved')}
              </Text>
            </Group>

            <DetailsCard state={state} onDispatch={dispatchFrom('details')} />
            {commandError && errorPanel === 'details' && <CommandErrorAlert />}

            <RoundControls
              state={state}
              onDispatch={dispatchFrom('rounds')}
              onPaired={(round) => selectTab(roundTab(round))}
            />
            {commandError && errorPanel === 'rounds' && <CommandErrorAlert />}

            <Tabs value={selectedTab ?? defaultTab(state)} onChange={selectTab} keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value={PLAYERS_TAB}>{t('tournament.rounds.tabPlayers')}</Tabs.Tab>
                <Tabs.Tab value={STANDINGS_TAB}>{t('tournament.standings.tab')}</Tabs.Tab>
                {state.rounds.map((round) => (
                  <Tabs.Tab key={round.number} value={roundTab(round.number)}>
                    {t('tournament.rounds.tabRound', { round: round.number })}
                  </Tabs.Tab>
                ))}
              </Tabs.List>

              <Tabs.Panel value={PLAYERS_TAB} pt="md">
                <Stack>
                  <RegistrationPanel
                    state={state}
                    players={players}
                    playersError={playersError}
                    onAddPlayer={(name) => usePlayersStore.getState().addPlayer(name)}
                    onDispatch={dispatchFrom('registration')}
                  />
                  {commandError && errorPanel === 'registration' && <CommandErrorAlert />}
                </Stack>
              </Tabs.Panel>
              <Tabs.Panel value={STANDINGS_TAB} pt="md">
                <StandingsPanel state={state} />
              </Tabs.Panel>
              {state.rounds.map((round) => (
                <Tabs.Panel key={round.number} value={roundTab(round.number)} pt="md">
                  <Stack>
                    <RoundPanel state={state} round={round} onDispatch={dispatchFrom('round')} />
                    {commandError && errorPanel === 'round' && <CommandErrorAlert />}
                  </Stack>
                </Tabs.Panel>
              ))}
            </Tabs>
          </>
        )}
      </Stack>
    </Container>
  );
}

function NoticeAlert({ notice }: { notice: SaveNotice }) {
  const { t } = useTranslation();
  const message =
    notice.kind === 'saveFailed'
      ? t('tournament.notices.saveFailed', {
          code: notice.error.code,
          message: notice.error.message,
        })
      : t(`tournament.notices.${notice.kind}`);
  return (
    <Alert
      color="red"
      withCloseButton
      closeButtonLabel={t('tournament.closeNotice')}
      onClose={() => useTournamentStore.getState().clearNotice()}
    >
      {message}
    </Alert>
  );
}

function CommandErrorAlert() {
  const { t } = useTranslation();
  const error = useTournamentStore((s) => s.commandError);
  if (error === null) {
    return null;
  }
  return (
    <Alert color="red">
      {t('tournament.commandError', { code: error.code, message: error.message })}
    </Alert>
  );
}
