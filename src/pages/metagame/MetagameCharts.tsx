import { BarChart } from '@mantine/charts';
import { Stack, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { MetagameGroup } from '../../domain';
import { useGroupLabel } from './MatchupMatrix';

export type ChartRow = { label: string; value: number };

/** Percent with two decimals, as the tables show it. */
const percent = (fraction: number) => Math.round(fraction * 10_000) / 100;

/** Rows of both charts, in group order. Groups with no match win rate are left out of `winRate`. */
export function metagameChartData(
  groups: readonly MetagameGroup[],
  labelOf: (group: MetagameGroup) => string,
): { share: ChartRow[]; winRate: ChartRow[] } {
  return {
    share: groups.map((group) => ({ label: labelOf(group), value: percent(group.stats.share) })),
    winRate: groups.flatMap((group) =>
      group.stats.matchWinRate === null
        ? []
        : [{ label: labelOf(group), value: percent(group.stats.matchWinRate) }],
    ),
  };
}

function Chart({ title, rows, max }: { title: string; rows: ChartRow[]; max?: number }) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs">
      <Title order={2}>{title}</Title>
      <BarChart
        h={rows.length * 32 + 48}
        data={rows}
        dataKey="label"
        orientation="vertical"
        series={[{ name: 'value', label: title, color: 'blue.6' }]}
        valueFormatter={(value) => t('tournament.standings.percent', { value: value.toFixed(2) })}
        xAxisProps={max === undefined ? undefined : { domain: [0, max] }}
        yAxisProps={{ width: 140 }}
        withTooltip={false}
        withBarValueLabel
      />
    </Stack>
  );
}

/** Share and match win % per group, as horizontal bars. The table holds the same numbers. */
export function MetagameCharts({ groups }: { groups: MetagameGroup[] }) {
  const { t } = useTranslation();
  const labelOf = useGroupLabel();
  const { share, winRate } = metagameChartData(groups, labelOf);
  return (
    <>
      <Chart title={t('metagame.charts.share')} rows={share} />
      {winRate.length > 0 && (
        <Chart title={t('metagame.charts.matchWinRate')} rows={winRate} max={100} />
      )}
    </>
  );
}
