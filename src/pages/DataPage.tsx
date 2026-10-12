import {
  Alert,
  Button,
  Container,
  FileButton,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DomainError, Uuid } from '../domain';
import {
  applyImport,
  buildDataset,
  datasetFileName,
  downloadJson,
  getPersistence,
  getStorage,
  planImport,
  readImportFile,
  tournamentFileName,
  type ConflictChoice,
  type ImportPlan,
  type ImportSummary,
  type PersistenceStatus,
  type StorageError,
  type TournamentSummary,
} from '../storage';
import { ImportConflictModal } from './data/ImportConflictModal';

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; tournaments: TournamentSummary[] }
  | { status: 'error'; error: StorageError };

/** The result of the last export or import, shown as one alert. */
type Notice =
  | { kind: 'exportFailed'; error: StorageError }
  | { kind: 'importInvalid'; error: DomainError }
  | { kind: 'importFailed'; error: StorageError }
  | { kind: 'imported'; summary: ImportSummary };

const SUMMARY_COUNTS = [
  'added',
  'updated',
  'unchanged',
  'olderThanLocal',
  'skipped',
  'overwritten',
  'copied',
  'playersAdded',
] as const;

export function DataPage() {
  const { t } = useTranslation();
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [persistence, setPersistence] = useState<PersistenceStatus | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<ImportPlan | null>(null);
  const resetFileRef = useRef<() => void>(null);

  useEffect(() => {
    let active = true;
    void getStorage()
      .listTournaments()
      .then((result) => {
        if (active) {
          setList(
            result.ok
              ? { status: 'ready', tournaments: result.value }
              : { status: 'error', error: result.error },
          );
        }
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    let active = true;
    void getPersistence().then((status) => {
      if (active) {
        setPersistence(status);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const unavailable = list.status === 'error' && list.error.code === 'UNAVAILABLE';
  const disabled = list.status !== 'ready' || busy;

  async function exportAll() {
    setNotice(null);
    const dataset = await buildDataset(getStorage());
    if (!dataset.ok) {
      setNotice({ kind: 'exportFailed', error: dataset.error });
      return;
    }
    downloadJson(datasetFileName(dataset.value.exportedAt), dataset.value);
  }

  async function exportTournament(summary: TournamentSummary) {
    setNotice(null);
    const loaded = await getStorage().loadTournament(summary.id);
    if (!loaded.ok) {
      setNotice({ kind: 'exportFailed', error: loaded.error });
      return;
    }
    downloadJson(tournamentFileName(summary.name, summary.date), loaded.value.doc);
  }

  async function apply(plan: ImportPlan, choices: Record<Uuid, ConflictChoice>) {
    setPendingPlan(null);
    const summary = await applyImport(getStorage(), plan, choices);
    setNotice({ kind: 'imported', summary });
    setBusy(false);
    setReloadKey((key) => key + 1);
  }

  async function importFile(file: File | null) {
    // Cleared so picking the same file again fires onChange.
    resetFileRef.current?.();
    if (!file) {
      return;
    }
    setNotice(null);
    setBusy(true);
    const parsed = await readImportFile(file);
    if (!parsed.ok) {
      setNotice({ kind: 'importInvalid', error: parsed.error });
      setBusy(false);
      return;
    }
    const plan = await planImport(getStorage(), parsed.value);
    if (!plan.ok) {
      setNotice({ kind: 'importFailed', error: plan.error });
      setBusy(false);
      return;
    }
    if (plan.value.items.some((item) => item.outcome === 'conflict')) {
      setPendingPlan(plan.value); // applied from the conflict modal
      return;
    }
    await apply(plan.value, {});
  }

  function cancelImport() {
    setPendingPlan(null);
    setBusy(false);
  }

  return (
    <Container py="xl">
      <Stack>
        <Group justify="space-between">
          <Title order={1}>{t('data.title')}</Title>
          <Group>
            <Button onClick={() => void exportAll()} disabled={disabled}>
              {t('data.exportAll')}
            </Button>
            <FileButton
              onChange={(file) => void importFile(file)}
              accept=".json,application/json"
              resetRef={resetFileRef}
              disabled={disabled}
            >
              {(props) => (
                <Button variant="light" disabled={disabled} {...props}>
                  {t('data.importFile')}
                </Button>
              )}
            </FileButton>
          </Group>
        </Group>

        {persistence && <Text size="sm">{t(`data.persistence.${persistence}`)}</Text>}

        {unavailable && <Alert color="red">{t('data.unavailable')}</Alert>}
        {list.status === 'error' && !unavailable && (
          <Alert color="red">
            {t('data.loadFailed', { code: list.error.code, message: list.error.message })}
          </Alert>
        )}
        {notice && notice.kind !== 'imported' && (
          <Alert color="red">
            {t(`data.${notice.kind}`, { code: notice.error.code, message: notice.error.message })}
          </Alert>
        )}
        {notice?.kind === 'imported' && <ImportSummaryAlert summary={notice.summary} />}

        {list.status === 'loading' && <Loader />}
        {list.status === 'ready' && list.tournaments.length === 0 && <Text>{t('data.empty')}</Text>}
        {list.status === 'ready' && list.tournaments.length > 0 && (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('data.columns.name')}</Table.Th>
                <Table.Th>{t('data.columns.date')}</Table.Th>
                <Table.Th>{t('data.columns.format')}</Table.Th>
                <Table.Th>{t('data.columns.status')}</Table.Th>
                <Table.Th>{t('data.columns.events')}</Table.Th>
                <Table.Th>{t('data.columns.actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.tournaments.map((summary) => (
                <Table.Tr key={summary.id}>
                  <Table.Td>{summary.name}</Table.Td>
                  <Table.Td>{summary.date}</Table.Td>
                  <Table.Td>{t(`data.formats.${summary.format}`)}</Table.Td>
                  <Table.Td>{t(`data.statuses.${summary.status}`)}</Table.Td>
                  <Table.Td>{summary.eventCount}</Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => void exportTournament(summary)}
                    >
                      {t('data.export')}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      {pendingPlan && (
        <ImportConflictModal
          conflicts={pendingPlan.items.filter((item) => item.outcome === 'conflict')}
          onCancel={cancelImport}
          onConfirm={(choices) => void apply(pendingPlan, choices)}
        />
      )}
    </Container>
  );
}

function ImportSummaryAlert({ summary }: { summary: ImportSummary }) {
  const { t } = useTranslation();
  const counts = SUMMARY_COUNTS.filter((key) => summary[key] > 0);
  const hasErrors = summary.failed.length > 0 || summary.playersFailed.length > 0;
  const nothing = counts.length === 0 && !hasErrors;

  return (
    <Alert
      color={hasErrors ? 'yellow' : 'green'}
      title={t(hasErrors ? 'data.summary.titleWithErrors' : 'data.summary.title')}
    >
      <Stack gap={2}>
        {nothing && <Text size="sm">{t('data.summary.nothing')}</Text>}
        {counts.map((key) => (
          <Text key={key} size="sm">
            {t(`data.summary.${key}`, { count: summary[key] })}
          </Text>
        ))}
        {summary.failed.map((failure) => (
          <Text key={failure.tournamentId} size="sm" c="red">
            {t('data.summary.failed', {
              name: failure.name,
              code: failure.error.code,
              message: failure.error.message,
            })}
          </Text>
        ))}
        {summary.playersFailed.map((failure) => (
          <Text key={failure.playerId} size="sm" c="red">
            {t('data.summary.playerFailed', {
              name: failure.name,
              code: failure.error.code,
              message: failure.error.message,
            })}
          </Text>
        ))}
      </Stack>
    </Alert>
  );
}
