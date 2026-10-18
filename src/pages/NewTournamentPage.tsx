import { Alert, Button, Container, Group, Stack, Title } from '@mantine/core';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { createTournament } from '../domain';
import { getStorage } from '../storage';
import {
  swissRoundsOf,
  TournamentFields,
  useTournamentForm,
  type TournamentFormValues,
} from './tournament/TournamentFields';

type CreateError = { code: string; message: string };

export function NewTournamentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CreateError | null>(null);

  const form = useTournamentForm({
    name: '',
    // A calendar day in the browser's local time zone, not a UTC instant.
    date: dayjs().format('YYYY-MM-DD'),
    location: '',
    format: null,
    rounds: 'auto',
    customRounds: 3,
  });

  async function create(values: TournamentFormValues) {
    setError(null);
    setBusy(true);
    const created = createTournament({
      name: values.name,
      date: values.date!,
      location: values.location,
      format: values.format!,
      swissRounds: swissRoundsOf(values),
    });
    if (!created.ok) {
      setError(created.error);
      setBusy(false);
      return;
    }
    const saved = await getStorage().saveTournament(created.value.doc, null);
    if (!saved.ok) {
      setError(saved.error);
      setBusy(false);
      return;
    }
    void navigate(`/tournaments/${created.value.doc.id}`);
  }

  return (
    <Container py="xl" size="sm">
      <form onSubmit={form.onSubmit((values) => void create(values))} noValidate>
        <Stack>
          <Title order={1}>{t('newTournament.title')}</Title>

          {error && (
            <Alert color="red">
              {t('newTournament.createFailed', { code: error.code, message: error.message })}
            </Alert>
          )}

          <TournamentFields form={form} />

          <Group justify="flex-end">
            <Button component={Link} to="/" variant="default">
              {t('newTournament.cancel')}
            </Button>
            <Button type="submit" loading={busy}>
              {t('newTournament.create')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Container>
  );
}
