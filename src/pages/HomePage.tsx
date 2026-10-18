import {
  Alert,
  Anchor,
  Button,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getStorage, type StorageError, type TournamentSummary } from '../storage';

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; tournaments: TournamentSummary[] }
  | { status: 'error'; error: StorageError };

/** Tournament list. Shows summary rows only; it never loads documents. */
export function HomePage() {
  const { t } = useTranslation();
  const [list, setList] = useState<ListState>({ status: 'loading' });

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

  const unavailable = list.status === 'error' && list.error.code === 'UNAVAILABLE';

  return (
    <Container py="xl">
      <Stack>
        <Group justify="space-between">
          <Title order={1}>{t('home.title')}</Title>
          <Button component={Link} to="/tournaments/new">
            {t('home.newTournament')}
          </Button>
        </Group>

        {unavailable && <Alert color="red">{t('home.unavailable')}</Alert>}
        {list.status === 'error' && !unavailable && (
          <Alert color="red">
            {t('home.loadFailed', { code: list.error.code, message: list.error.message })}
          </Alert>
        )}

        {list.status === 'loading' && <Loader />}
        {list.status === 'ready' && list.tournaments.length === 0 && <Text>{t('home.empty')}</Text>}
        {list.status === 'ready' && list.tournaments.length > 0 && (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('home.columns.name')}</Table.Th>
                <Table.Th>{t('home.columns.date')}</Table.Th>
                <Table.Th>{t('home.columns.format')}</Table.Th>
                <Table.Th>{t('home.columns.status')}</Table.Th>
                <Table.Th>{t('home.columns.players')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.tournaments.map((summary) => (
                <Table.Tr key={summary.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`/tournaments/${summary.id}`}>
                      {summary.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{summary.date}</Table.Td>
                  <Table.Td>{t(`formats.${summary.format}`)}</Table.Td>
                  <Table.Td>{t(`statuses.${summary.status}`)}</Table.Td>
                  <Table.Td>{summary.playerCount}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Container>
  );
}
