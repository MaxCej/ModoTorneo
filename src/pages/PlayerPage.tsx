import {
  Anchor,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { playerProfile, type PlayerHistoryRow, type PlayerTotals } from '../domain';
import { readSettings } from '../storage';
import { usePlayersStore } from '../store/playersStore';
import { StorageErrorAlert } from './StorageErrorAlert';
import { useStatsFormat } from './players/format';
import { RenamePlayerModal } from './players/RenamePlayerModal';
import { usePlayersData } from './players/usePlayersData';

/** One registry player's profile: totals, per format and tournament history, from summaries. */
export function PlayerPage() {
  const { t } = useTranslation();
  const format = useStatsFormat();
  const { id } = useParams();
  const data = usePlayersData();
  const [settings] = useState(readSettings);
  const [renaming, setRenaming] = useState(false);

  const player = data.status === 'ready' ? data.players.find((p) => p.id === id) : undefined;
  const profile = useMemo(
    () =>
      data.status === 'ready' && id !== undefined ? playerProfile(id, data.tournaments) : null,
    [data, id],
  );

  if (data.status === 'loading') {
    return (
      <Container py="xl">
        <Loader />
      </Container>
    );
  }
  if (data.status === 'error') {
    return (
      <Container py="xl">
        <StorageErrorAlert error={data.error} settings={settings} page="players" />
      </Container>
    );
  }
  if (player === undefined || profile === null) {
    return (
      <Container py="xl">
        <Stack>
          <Text>{t('players.profile.notFound')}</Text>
          <Anchor component={Link} to="/players">
            {t('players.profile.backToList')}
          </Anchor>
        </Stack>
      </Container>
    );
  }

  const { totals, byFormat, history, bestPlacing } = profile;

  return (
    <Container py="xl">
      <Stack>
        <Group justify="space-between">
          <Title order={1}>{player.name}</Title>
          <Button variant="default" onClick={() => setRenaming(true)}>
            {t('players.profile.rename')}
          </Button>
        </Group>
        {renaming && (
          <RenamePlayerModal
            player={player}
            otherNames={data.players.filter((p) => p.id !== player.id).map((p) => p.name)}
            onSave={(name) => usePlayersStore.getState().renamePlayer(player.id, name)}
            onClose={() => setRenaming(false)}
          />
        )}

        <Card withBorder>
          <Table
            variant="vertical"
            layout="fixed"
            withTableBorder
            aria-label={t('players.profile.totalsLabel')}
          >
            <Table.Tbody>
              <TotalsRow label={t('players.columns.tournaments')}>{totals.tournaments}</TotalsRow>
              <TotalsRow label={t('players.columns.record')}>
                {format.record(totals.matches)}
              </TotalsRow>
              <TotalsRow label={t('players.columns.matchWinRate')}>
                {format.percent(totals.matchWinRate)}
              </TotalsRow>
              <TotalsRow label={t('players.columns.gameWinRate')}>
                {format.percent(totals.gameWinRate)}
              </TotalsRow>
              <TotalsRow label={t('players.profile.byes')}>{totals.byes}</TotalsRow>
              <TotalsRow label={t('players.profile.topCuts')}>{totals.topCuts}</TotalsRow>
              <TotalsRow label={t('players.profile.bestPlacing')}>
                {format.placing(bestPlacing)}
              </TotalsRow>
            </Table.Tbody>
          </Table>
        </Card>

        {history.length === 0 ? (
          <Text>{t('players.profile.noTournaments', { name: player.name })}</Text>
        ) : (
          <>
            <Title order={2}>{t('players.profile.byFormat')}</Title>
            <Table.ScrollContainer minWidth={480}>
              <Table withTableBorder fz="sm" aria-label={t('players.profile.byFormat')}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('players.profile.format')}</Table.Th>
                    <Table.Th>{t('players.columns.tournaments')}</Table.Th>
                    <Table.Th>{t('players.columns.record')}</Table.Th>
                    <Table.Th>{t('players.columns.matchWinRate')}</Table.Th>
                    <Table.Th>{t('players.columns.gameWinRate')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {byFormat.map((row) => (
                    <FormatRow key={row.format} row={row} />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            <Title order={2}>{t('players.profile.history')}</Title>
            <Table.ScrollContainer minWidth={820}>
              <Table withTableBorder fz="sm" aria-label={t('players.profile.historyLabel')}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('players.profile.date')}</Table.Th>
                    <Table.Th>{t('players.profile.tournament')}</Table.Th>
                    <Table.Th>{t('players.profile.deck')}</Table.Th>
                    <Table.Th>{t('players.profile.format')}</Table.Th>
                    <Table.Th>{t('players.profile.status')}</Table.Th>
                    <Table.Th>{t('players.profile.swiss')}</Table.Th>
                    <Table.Th>{t('players.profile.swissRank')}</Table.Th>
                    <Table.Th>{t('players.profile.topCut')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.map((row) => (
                    <HistoryRow key={row.id} row={row} />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </>
        )}
      </Stack>
    </Container>
  );
}

function TotalsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Table.Tr>
      <Table.Th w={180} scope="row">
        {label}
      </Table.Th>
      <Table.Td>{children}</Table.Td>
    </Table.Tr>
  );
}

function FormatRow({ row }: { row: PlayerTotals & { format: string } }) {
  const { t } = useTranslation();
  const format = useStatsFormat();
  return (
    <Table.Tr>
      <Table.Td>{t(`formats.${row.format}`)}</Table.Td>
      <Table.Td>{row.tournaments}</Table.Td>
      <Table.Td>{format.record(row.matches)}</Table.Td>
      <Table.Td>{format.percent(row.matchWinRate)}</Table.Td>
      <Table.Td>{format.percent(row.gameWinRate)}</Table.Td>
    </Table.Tr>
  );
}

function HistoryRow({ row }: { row: PlayerHistoryRow }) {
  const { t } = useTranslation();
  const format = useStatsFormat();
  const { result } = row;
  const swiss = format.record(result.swiss);
  return (
    <Table.Tr>
      <Table.Td>{row.date}</Table.Td>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          <Anchor component={Link} to={`/tournaments/${row.id}`}>
            {row.name}
          </Anchor>
          {result.dropped && (
            <Badge size="sm" variant="light" color="gray">
              {t('tournament.standings.dropped')}
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td>{result.archetype ?? format.none}</Table.Td>
      <Table.Td>{t(`formats.${row.format}`)}</Table.Td>
      <Table.Td>{t(`statuses.${row.status}`)}</Table.Td>
      <Table.Td>
        {result.swiss.byes > 0
          ? t('players.profile.swissWithByes', { record: swiss, count: result.swiss.byes })
          : swiss}
      </Table.Td>
      <Table.Td>
        {result.swissRank === null
          ? format.none
          : t('players.profile.rankOf', { rank: result.swissRank, players: row.playerCount })}
      </Table.Td>
      <Table.Td>{format.placing(result.placing)}</Table.Td>
    </Table.Tr>
  );
}
