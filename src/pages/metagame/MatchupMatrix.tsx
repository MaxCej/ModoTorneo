import { ScrollArea, Stack, Table, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { MatrixCell, MetagameGroup } from '../../domain';
import { useStatsFormat } from '../players/format';

/** The label of a group: its archetype, "Other" or "Unknown". */
export function useGroupLabel() {
  const { t } = useTranslation();
  return (group: MetagameGroup) =>
    group.kind === 'archetype'
      ? (group.stats.archetype ?? t('metagame.unknown'))
      : t(`metagame.${group.kind}`);
}

function Cell({ cell }: { cell: MatrixCell }) {
  const { t } = useTranslation();
  const format = useStatsFormat();
  switch (cell.kind) {
    case 'none':
      return <>{format.none}</>;
    case 'mirror':
      return (
        <Text span c="dimmed" fz="sm">
          {t('metagame.matrix.mirror', { count: cell.matches })}
        </Text>
      );
    case 'matchup':
      return (
        <Stack gap={0}>
          <span>{format.percent(cell.winRate)}</span>
          <Text span c="dimmed" fz="xs">
            {format.record(cell)}
          </Text>
        </Stack>
      );
  }
}

/** Match win % of each row group against each column group, in report order. */
export function MatchupMatrix({
  groups,
  matrix,
}: {
  groups: MetagameGroup[];
  matrix: MatrixCell[][];
}) {
  const { t } = useTranslation();
  const labelOf = useGroupLabel();
  const labels = groups.map(labelOf);
  return (
    <Stack gap="xs">
      <Title order={2}>{t('metagame.matrix.title')}</Title>
      <ScrollArea>
        <Table withTableBorder withColumnBorders fz="sm" captionSide="top">
          <Table.Caption>{t('metagame.matrix.caption')}</Table.Caption>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('metagame.columns.archetype')}</Table.Th>
              {labels.map((label, j) => (
                <Table.Th key={j} scope="col">
                  {label}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {matrix.map((row, i) => (
              <Table.Tr key={i}>
                <Table.Th scope="row">{labels[i]}</Table.Th>
                {row.map((cell, j) => (
                  <Table.Td key={j}>
                    <Cell cell={cell} />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}
