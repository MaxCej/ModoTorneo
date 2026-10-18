import {
  Alert,
  Button,
  Container,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { createTournament, FormatSchema, type Format } from '../domain';
import { getStorage } from '../storage';

type FormValues = {
  name: string;
  date: string | null; // YYYY-MM-DD
  location: string;
  format: Format | null;
  rounds: 'auto' | 'custom';
  customRounds: number | string; // NumberInput gives '' when cleared
};

type CreateError = { code: string; message: string };

export function NewTournamentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CreateError | null>(null);

  const form = useForm<FormValues>({
    initialValues: {
      name: '',
      // A calendar day in the browser's local time zone, not a UTC instant.
      date: dayjs().format('YYYY-MM-DD'),
      location: '',
      format: null,
      rounds: 'auto',
      customRounds: 3,
    },
    validate: {
      name: (value) => {
        const name = value.trim();
        if (name.length === 0) {
          return t('newTournament.errors.nameRequired');
        }
        return name.length > 100 ? t('newTournament.errors.tooLong') : null;
      },
      date: (value) => (value ? null : t('newTournament.errors.dateRequired')),
      location: (value) => (value.trim().length > 100 ? t('newTournament.errors.tooLong') : null),
      format: (value) => (value ? null : t('newTournament.errors.formatRequired')),
      customRounds: (value, values) =>
        values.rounds === 'custom' &&
        !(typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20)
          ? t('newTournament.errors.rounds')
          : null,
    },
  });

  async function create(values: FormValues) {
    setError(null);
    setBusy(true);
    const created = createTournament({
      name: values.name,
      date: values.date!,
      location: values.location,
      format: values.format!,
      swissRounds: values.rounds === 'auto' ? null : Number(values.customRounds),
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

          <TextInput
            label={t('newTournament.name')}
            required
            maxLength={100}
            {...form.getInputProps('name')}
          />
          <DatePickerInput
            label={t('newTournament.date')}
            required
            {...form.getInputProps('date')}
          />
          <TextInput
            label={t('newTournament.location')}
            maxLength={100}
            {...form.getInputProps('location')}
          />
          <Select
            label={t('newTournament.format')}
            placeholder={t('newTournament.formatPlaceholder')}
            required
            data={FormatSchema.options.map((format) => ({
              value: format,
              label: t(`formats.${format}`),
            }))}
            {...form.getInputProps('format')}
          />

          <Stack gap={4}>
            <Text size="sm" fw={500} id="swiss-rounds-label">
              {t('newTournament.swissRounds')}
            </Text>
            <SegmentedControl
              aria-labelledby="swiss-rounds-label"
              data={[
                { value: 'auto', label: t('newTournament.roundsAuto') },
                { value: 'custom', label: t('newTournament.roundsCustom') },
              ]}
              {...form.getInputProps('rounds')}
            />
            {form.values.rounds === 'custom' && (
              <NumberInput
                label={t('newTournament.roundsCount')}
                min={1}
                max={20}
                allowDecimal={false}
                {...form.getInputProps('customRounds')}
              />
            )}
          </Stack>

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
