import { Badge, Button, Card, Collapse, Group, Stack, Table, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  activePlayerCount,
  editableDetails,
  recommendedSwissRounds,
  type Command,
  type DomainError,
  type Result,
  type TournamentDetailsChangedPayload,
  type TournamentState,
} from '../../domain';
import { RoundsTable } from './RoundsTable';
import {
  swissRoundsOf,
  TournamentFields,
  useTournamentForm,
  type TournamentField,
  type TournamentFormValues,
} from './TournamentFields';

type Props = {
  state: TournamentState;
  onDispatch: (cmd: Command) => Result<TournamentState, DomainError>;
};

function formValuesOf(state: TournamentState): TournamentFormValues {
  return {
    name: state.name,
    date: state.date,
    location: state.location,
    format: state.format,
    rounds: state.swissRounds === null ? 'auto' : 'custom',
    customRounds: state.swissRounds ?? 3,
  };
}

/** Only the fields that differ from the current state. Call only on validated values. */
function changedDetails(
  state: TournamentState,
  values: TournamentFormValues,
): TournamentDetailsChangedPayload {
  const changes: TournamentDetailsChangedPayload = {};
  const name = values.name.trim();
  const location = values.location.trim();
  const swissRounds = swissRoundsOf(values);
  if (name !== state.name) changes.name = name;
  if (values.date !== state.date) changes.date = values.date!;
  if (location !== state.location) changes.location = location;
  if (values.format !== state.format) changes.format = values.format!;
  if (swissRounds !== state.swissRounds) changes.swissRounds = swissRounds;
  return changes;
}

export function DetailsCard({ state, onDispatch }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [tableOpen, { toggle: toggleTable }] = useDisclosure(false);
  const active = activePlayerCount(state);

  const recommendedToggle = (
    <>
      <Button
        variant="subtle"
        size="compact-sm"
        onClick={toggleTable}
        aria-expanded={tableOpen}
        w="fit-content"
      >
        {t('tournament.details.recommended')}
      </Button>
      <Collapse expanded={tableOpen}>
        <RoundsTable activePlayers={active} />
      </Collapse>
    </>
  );

  return (
    <Card withBorder>
      <Stack>
        <Group justify="space-between">
          <Title order={2} size="h3">
            {t('tournament.details.title')}
          </Title>
          {!editing && (
            <Button variant="light" onClick={() => setEditing(true)}>
              {t('tournament.details.edit')}
            </Button>
          )}
        </Group>

        {editing ? (
          <DetailsForm
            state={state}
            roundsExtra={recommendedToggle}
            onCancel={() => setEditing(false)}
            onSave={(payload) => {
              if (onDispatch({ type: 'TournamentDetailsChanged', payload }).ok) {
                setEditing(false);
              }
            }}
          />
        ) : (
          <>
            <Table variant="vertical" layout="fixed" withTableBorder>
              <Table.Tbody>
                <DetailRow label={t('tournament.details.name')}>{state.name}</DetailRow>
                <DetailRow label={t('tournament.details.date')}>{state.date}</DetailRow>
                <DetailRow label={t('tournament.details.location')}>
                  {state.location || t('tournament.details.noLocation')}
                </DetailRow>
                <DetailRow label={t('tournament.details.format')}>
                  {t(`formats.${state.format}`)}
                </DetailRow>
                <DetailRow label={t('tournament.details.status')}>
                  <Badge variant="light">{t(`statuses.${state.status}`)}</Badge>
                </DetailRow>
                <DetailRow label={t('tournament.details.swissRounds')}>
                  <SwissRoundsText swissRounds={state.swissRounds} active={active} />
                </DetailRow>
              </Table.Tbody>
            </Table>
            {recommendedToggle}
          </>
        )}
      </Stack>
    </Card>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Table.Tr>
      <Table.Th w={160} scope="row">
        {label}
      </Table.Th>
      <Table.Td>{children}</Table.Td>
    </Table.Tr>
  );
}

function SwissRoundsText({ swissRounds, active }: { swissRounds: number | null; active: number }) {
  const { t } = useTranslation();
  if (swissRounds !== null) {
    return <Text span>{swissRounds}</Text>;
  }
  const rounds = recommendedSwissRounds(active);
  return (
    <Text span>
      {rounds === null
        ? t('tournament.details.roundsAutoTooFew')
        : t('tournament.details.roundsAuto', { rounds, players: active })}
    </Text>
  );
}

type FormProps = {
  state: TournamentState;
  roundsExtra: ReactNode;
  onCancel: () => void;
  onSave: (payload: TournamentDetailsChangedPayload) => void;
};

function DetailsForm({ state, roundsExtra, onCancel, onSave }: FormProps) {
  const { t } = useTranslation();
  const form = useTournamentForm(formValuesOf(state));
  const allowed = editableDetails(state.status);
  const disabled = Object.fromEntries(
    (['name', 'date', 'location', 'format', 'swissRounds'] as const).map(
      (field: TournamentField) => [field, !allowed.includes(field)],
    ),
  );
  // An unfinished edit (e.g. a cleared name) still counts as a change; validation blocks it.
  const dirty = form.isValid()
    ? Object.keys(changedDetails(state, form.values)).length > 0
    : form.isDirty();

  return (
    <form onSubmit={form.onSubmit((values) => onSave(changedDetails(state, values)))} noValidate>
      <Stack>
        <TournamentFields
          form={form}
          disabled={disabled}
          autoDisabled={state.status !== 'setup'}
          roundsExtra={roundsExtra}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t('tournament.details.cancel')}
          </Button>
          <Button type="submit" disabled={!dirty}>
            {t('tournament.details.save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
