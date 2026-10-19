import {
  Badge,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  activePlayerCount,
  defaultTopCutSize,
  resolvedSwissRounds,
  seedPreview,
  type BestOf,
  type TopCutSize,
  type TournamentState,
} from '../../domain';

const SIZES: TopCutSize[] = [4, 8, 16, 32];

type Props = {
  state: TournamentState;
  onCancel: () => void;
  onConfirm: (size: TopCutSize, bestOf: BestOf) => void;
};

/** Size, best-of and the seeds before starting the top cut. */
export function StartTopCutModal({ state, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const active = activePlayerCount(state);
  const recommended = defaultTopCutSize(active);
  const [size, setSize] = useState<TopCutSize>(recommended ?? 4);
  const [bestOf, setBestOf] = useState<BestOf>(3);

  const played = state.rounds.filter((round) => round.stage === 'swiss').length;
  const total = resolvedSwissRounds(state);
  const { seeds, tieAtCutLine } = seedPreview(state, size);
  const name = (playerId: string) => state.players[playerId]?.playerName ?? playerId;
  const otherTies = seeds.some(
    (seed) => seed.tiedWith.length > 0 && !tieAtCutLine.includes(seed.playerId),
  );

  return (
    <Modal opened onClose={onCancel} title={t('tournament.topCut.startModal.title')}>
      <Stack>
        {total !== null && played < total && (
          <Text>{t('tournament.topCut.startModal.early', { played, total })}</Text>
        )}
        <Select
          label={t('tournament.topCut.startModal.size')}
          value={String(size)}
          onChange={(value) => value !== null && setSize(Number(value) as TopCutSize)}
          allowDeselect={false}
          data={SIZES.map((option) => ({
            value: String(option),
            label: t('tournament.topCut.startModal.sizeOption', { size: option }),
            disabled: option > active,
          }))}
        />
        {recommended === null && (
          <Text size="sm" c="dimmed">
            {t('tournament.topCut.startModal.notRecommended')}
          </Text>
        )}
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            {t('tournament.topCut.startModal.bestOf')}
          </Text>
          <SegmentedControl
            w="fit-content"
            aria-label={t('tournament.topCut.startModal.bestOf')}
            value={String(bestOf)}
            onChange={(value) => setBestOf(Number(value) as BestOf)}
            data={([3, 5] as const).map((option) => ({
              value: String(option),
              label: t('tournament.topCut.startModal.bestOfOption', { bestOf: option }),
            }))}
          />
        </Stack>
        <Table.ScrollContainer minWidth={320}>
          <Table fz="sm" aria-label={t('tournament.topCut.startModal.seeds')}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('tournament.topCut.startModal.seed')}</Table.Th>
                <Table.Th>{t('tournament.topCut.startModal.player')}</Table.Th>
                <Table.Th>{t('tournament.topCut.startModal.points')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {seeds.map((seed, i) => (
                <Table.Tr key={seed.playerId}>
                  <Table.Td>{i + 1}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      {seed.playerName}
                      {seed.tiedWith.length > 0 && (
                        <Badge size="sm" variant="light" color="yellow">
                          {t('tournament.topCut.startModal.tied')}
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{seed.matchPoints}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {tieAtCutLine.length > 0 && (
          <Text size="sm">
            {t('tournament.topCut.startModal.cutLineTie', {
              names: tieAtCutLine.map(name).join(', '),
            })}
          </Text>
        )}
        {otherTies && <Text size="sm">{t('tournament.topCut.startModal.otherTies')}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t('tournament.topCut.startModal.cancel')}
          </Button>
          <Button onClick={() => onConfirm(size, bestOf)}>
            {t('tournament.topCut.startModal.confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
