import { Badge, Button, Group, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { Match, MatchResult } from '../../domain';

/** One-click results, always from player A's side. */
export const RESULT_PRESETS: ReadonlyArray<{ key: string; result: MatchResult }> = [
  { key: 'win20', result: { winsA: 2, winsB: 0, draws: 0, kind: 'played' } },
  { key: 'win21', result: { winsA: 2, winsB: 1, draws: 0, kind: 'played' } },
  { key: 'loss12', result: { winsA: 1, winsB: 2, draws: 0, kind: 'played' } },
  { key: 'loss02', result: { winsA: 0, winsB: 2, draws: 0, kind: 'played' } },
  { key: 'draw111', result: { winsA: 1, winsB: 1, draws: 1, kind: 'played' } },
  { key: 'intentionalDraw', result: { winsA: 0, winsB: 0, draws: 0, kind: 'intentionalDraw' } },
  { key: 'unplayed', result: { winsA: 0, winsB: 0, draws: 0, kind: 'unplayed' } },
];

function sameResult(a: MatchResult, b: MatchResult): boolean {
  return a.kind === b.kind && a.winsA === b.winsA && a.winsB === b.winsB && a.draws === b.draws;
}

/** The text shown for a result: "2-1", "1-1-1", "ID", "Unplayed". */
export function useResultText() {
  const { t } = useTranslation();
  return (result: MatchResult | null): string => {
    if (result === null) {
      return t('tournament.rounds.noResult');
    }
    if (result.kind === 'intentionalDraw') {
      return t('tournament.rounds.presets.intentionalDraw');
    }
    if (result.kind === 'unplayed') {
      return t('tournament.rounds.presets.unplayed');
    }
    return result.draws > 0
      ? t('tournament.rounds.scoreWithDraws', result)
      : t('tournament.rounds.score', result);
  };
}

type Props = {
  match: Match;
  labelA: string;
  /** null for a bye. */
  labelB: string | null;
  readOnly: boolean;
  onReport: (result: MatchResult) => void;
};

/** Table, player A, result controls, player B. */
export function MatchRow({ match, labelA, labelB, readOnly, onReport }: Props) {
  const { t } = useTranslation();
  const resultText = useResultText();
  const bye = match.playerB === null;
  const current = match.result;
  const matchesPreset =
    current !== null && RESULT_PRESETS.some((preset) => sameResult(preset.result, current));

  return (
    <Group
      role="group"
      aria-label={t('tournament.rounds.tableLabel', { table: match.table })}
      wrap="wrap"
      gap="sm"
      py={4}
    >
      <Badge variant="light" w={64}>
        {t('tournament.rounds.table', { table: match.table })}
      </Badge>
      <Text miw={180} fw={500}>
        {labelA}
      </Text>

      {bye ? (
        <Text c="dimmed">{t('tournament.rounds.bye')}</Text>
      ) : (
        <>
          {readOnly ? (
            <Text fw={700} miw={80}>
              {resultText(current)}
            </Text>
          ) : (
            <Group gap={4} wrap="wrap">
              {RESULT_PRESETS.map((preset) => {
                const selected = current !== null && sameResult(preset.result, current);
                return (
                  <Button
                    key={preset.key}
                    size="compact-sm"
                    variant={selected ? 'filled' : 'default'}
                    aria-pressed={selected}
                    onClick={() => onReport(preset.result)}
                  >
                    {t(`tournament.rounds.presets.${preset.key}`)}
                  </Button>
                );
              })}
              {current !== null && !matchesPreset && (
                <Text fw={700} px="xs">
                  {resultText(current)}
                </Text>
              )}
            </Group>
          )}
          <Text miw={180} fw={500}>
            {labelB}
          </Text>
        </>
      )}
    </Group>
  );
}
