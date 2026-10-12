import { Alert, Button, Container, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildDataset,
  datasetFileName,
  downloadJson,
  getPersistence,
  getStorage,
  tournamentFileName,
  type PersistenceStatus,
  type StorageError,
  type TournamentSummary,
} from '../storage';

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; tournaments: TournamentSummary[] }
  | { status: 'error'; error: StorageError };

export function DataPage() {
  const { t } = useTranslation();
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [persistence, setPersistence] = useState<PersistenceStatus | null>(null);
  const [exportError, setExportError] = useState<StorageError | null>(null);

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
  }, []);

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
  const disabled = list.status !== 'ready';

  async function exportAll() {
    setExportError(null);
    const dataset = await buildDataset(getStorage());
    if (!dataset.ok) {
      setExportError(dataset.error);
      return;
    }
    downloadJson(datasetFileName(dataset.value.exportedAt), dataset.value);
  }

  async function exportTournament(summary: TournamentSummary) {
    setExportError(null);
    const loaded = await getStorage().loadTournament(summary.id);
    if (!loaded.ok) {
      setExportError(loaded.error);
      return;
    }
    downloadJson(tournamentFileName(summary.name, summary.date), loaded.value.doc);
  }

  return (
    <Container py="xl">
      <Stack>
        <Group justify="space-between">
          <Title order={1}>{t('data.title')}</Title>
          <Button onClick={() => void exportAll()} disabled={disabled}>
            {t('data.exportAll')}
          </Button>
        </Group>

        {persistence && <Text size="sm">{t(`data.persistence.${persistence}`)}</Text>}

        {unavailable && <Alert color="red">{t('data.unavailable')}</Alert>}
        {list.status === 'error' && !unavailable && (
          <Alert color="red">
            {t('data.loadFailed', { code: list.error.code, message: list.error.message })}
          </Alert>
        )}
        {exportError && (
          <Alert color="red">
            {t('data.exportFailed', { code: exportError.code, message: exportError.message })}
          </Alert>
        )}

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
    </Container>
  );
}
