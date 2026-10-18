import { Alert, Anchor, Center, Container, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { Command } from '../domain';
import { usePlayersStore } from '../store/playersStore';
import { useTournamentStore, type SaveNotice } from '../store/tournamentStore';
import { DetailsCard } from './tournament/DetailsCard';
import { RegistrationPanel } from './tournament/RegistrationPanel';

/** The panel whose command was rejected last, so its error shows under it. */
type Panel = 'details' | 'registration';

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

            <RegistrationPanel
              state={state}
              players={players}
              playersError={playersError}
              onAddPlayer={(name) => usePlayersStore.getState().addPlayer(name)}
              onDispatch={dispatchFrom('registration')}
            />
            {commandError && errorPanel === 'registration' && <CommandErrorAlert />}
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
