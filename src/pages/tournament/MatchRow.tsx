import { Badge, Button, Group, NumberInput, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fitsBestOf, MatchResultSchema, type Match, type MatchResult } from '../../domain';

/** Swiss matches are best of three. */
const SWISS_BEST_OF = 3;

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
  const [customOpen, setCustomOpen] = useState(false);
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
              <Button
                size="compact-sm"
                variant="subtle"
                aria-expanded={customOpen}
                onClick={() => setCustomOpen((open) => !open)}
              >
                {t('tournament.rounds.custom')}
              </Button>
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
          {customOpen && !readOnly && (
            <CustomResult
              initial={current}
              onCancel={() => setCustomOpen(false)}
              onSave={(result) => {
                onReport(result);
                setCustomOpen(false);
              }}
            />
          )}
        </>
      )}
    </Group>
  );
}

type CustomProps = {
  initial: MatchResult | null;
  onCancel: () => void;
  onSave: (result: MatchResult) => void;
};

/** Three game counts, checked with `MatchResultSchema` and the best-of-three rule. */
function CustomResult({ initial, onCancel, onSave }: CustomProps) {
  const { t } = useTranslation();
  const start = initial?.kind === 'played' ? initial : null;
  const [winsA, setWinsA] = useState<number | string>(start?.winsA ?? 0);
  const [winsB, setWinsB] = useState<number | string>(start?.winsB ?? 0);
  const [draws, setDraws] = useState<number | string>(start?.draws ?? 0);
  const [invalid, setInvalid] = useState(false);

  function save() {
    const parsed = MatchResultSchema.safeParse({ winsA, winsB, draws, kind: 'played' });
    if (!parsed.success || !fitsBestOf(parsed.data, SWISS_BEST_OF)) {
      setInvalid(true);
      return;
    }
    onSave(parsed.data);
  }

  const field = (label: string, value: number | string, set: (v: number | string) => void) => (
    <NumberInput
      label={label}
      value={value}
      onChange={(v) => {
        set(v);
        setInvalid(false);
      }}
      min={0}
      max={3}
      allowDecimal={false}
      allowNegative={false}
      w={110}
    />
  );

  return (
    <Stack gap={4} w="100%">
      <Group gap="sm" align="flex-end">
        {field(t('tournament.rounds.customWinsA'), winsA, setWinsA)}
        {field(t('tournament.rounds.customWinsB'), winsB, setWinsB)}
        {field(t('tournament.rounds.customDraws'), draws, setDraws)}
        <Button size="sm" onClick={save}>
          {t('tournament.rounds.customSave')}
        </Button>
        <Button size="sm" variant="default" onClick={onCancel}>
          {t('tournament.rounds.customCancel')}
        </Button>
      </Group>
      {invalid && (
        <Text size="sm" c="red" role="alert">
          {t('tournament.rounds.customInvalid')}
        </Text>
      )}
    </Stack>
  );
}
