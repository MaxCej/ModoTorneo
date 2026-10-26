import { Stack, Text, type MantineStyleProp } from '@mantine/core';
import { useTranslation } from 'react-i18next';

/**
 * `MM:SS` under one hour, `H:MM:SS` from one hour. A countdown rounds seconds up (a fresh
 * 50-minute timer shows `50:00`); overtime (0 or below) rounds down and gets a `+`.
 */
export function formatClock(remaining: number): string {
  const overtime = remaining <= 0;
  const seconds = overtime ? Math.floor(-remaining / 1000) : Math.ceil(remaining / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return overtime ? `+${clock}` : clock;
}

type Props = {
  remaining: number;
  paused: boolean;
  /** Font size of the digits, e.g. `rem(48)` on the card or a `clamp(…)` on the big timer. */
  size: string;
  labelSize?: string;
};

/** The clock digits, red with "Time" in overtime, dimmed with "Paused" when paused. */
export function Clock({ remaining, paused, size, labelSize }: Props) {
  const { t } = useTranslation();
  const overtime = remaining <= 0;
  const digits: MantineStyleProp = {
    fontSize: size,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  };
  return (
    <Stack gap={4} align="center">
      <Text
        ff="monospace"
        fw={700}
        style={digits}
        c={overtime ? 'red' : paused ? 'dimmed' : undefined}
        data-testid="timer-clock"
      >
        {formatClock(remaining)}
      </Text>
      {(overtime || paused) && (
        <Text fw={700} fz={labelSize} c={overtime ? 'red' : 'dimmed'}>
          {overtime ? t('timer.time') : t('timer.paused')}
        </Text>
      )}
    </Stack>
  );
}
