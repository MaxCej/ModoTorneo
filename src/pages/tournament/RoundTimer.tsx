import { Button, Card, Group, Modal, NumberInput, Stack, Text, Title, rem } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  adjustTimer,
  MINUTE_MS,
  pauseTimer,
  resumeTimer,
  startTimer,
  type TimerState,
} from '../../domain';
import {
  DEFAULT_ROUND_MINUTES,
  emptyTimerRecord,
  MAX_ROUND_MINUTES,
  roundTimer,
  withRoundTimer,
  type OpenRound,
  type TimerRecord,
} from '../../storage/timerStorage';
import { Clock } from '../timer/Clock';
import { roundLabel } from '../timer/roundLabel';
import { useClock } from '../timer/useClock';

type Props = {
  tournamentName: string;
  openRound: OpenRound;
  record: TimerRecord | null;
  onChange: (next: TimerRecord) => void;
};

/** The open round's timer (SPEC 13). Kept in this browser only; never saves the tournament. */
export function RoundTimer({ tournamentName, openRound, record, onChange }: Props) {
  const { t } = useTranslation();
  const timer = roundTimer(record, openRound.round);
  const remaining = useClock(timer);
  const [minutes, setMinutes] = useState<number | string>(record?.minutes ?? DEFAULT_ROUND_MINUTES);
  const [resetting, setResetting] = useState(false);
  const validMinutes =
    typeof minutes === 'number' &&
    Number.isInteger(minutes) &&
    minutes >= 1 &&
    minutes <= MAX_ROUND_MINUTES;

  function update(state: TimerState | null, extra: Partial<TimerRecord> = {}) {
    const base = record ?? { ...emptyTimerRecord(tournamentName), openRound };
    onChange({ ...withRoundTimer(base, openRound.round, state), ...extra });
  }

  function start() {
    if (validMinutes) {
      update(startTimer(minutes, Date.now()), { minutes });
    }
  }

  const label = roundLabel(t, openRound);

  return (
    <Card withBorder aria-label={t('timer.cardLabel')} component="section">
      <Stack gap="sm">
        <Title order={2} size="h4">
          {t('timer.heading', { round: label })}
        </Title>
        {timer === null || remaining === null ? (
          <Group align="flex-end">
            <Text c="dimmed">{t('timer.notStarted')}</Text>
            <NumberInput
              label={t('timer.minutes')}
              value={minutes}
              onChange={setMinutes}
              min={1}
              max={MAX_ROUND_MINUTES}
              allowDecimal={false}
              allowNegative={false}
              w={120}
            />
            <Button onClick={start} disabled={!validMinutes}>
              {t('timer.start')}
            </Button>
          </Group>
        ) : (
          <>
            <Clock remaining={remaining} paused={timer.kind === 'paused'} size={rem(56)} />
            <Group justify="center" gap="sm">
              {timer.kind === 'running' ? (
                <Button onClick={() => update(pauseTimer(timer, Date.now()))}>
                  {t('timer.pause')}
                </Button>
              ) : (
                <Button onClick={() => update(resumeTimer(timer, Date.now()))}>
                  {t('timer.resume')}
                </Button>
              )}
              <Button
                variant="light"
                onClick={() => update(adjustTimer(timer, MINUTE_MS, Date.now()))}
              >
                {t('timer.addMinute')}
              </Button>
              <Button
                variant="light"
                disabled={remaining <= 0}
                onClick={() => update(adjustTimer(timer, -MINUTE_MS, Date.now()))}
              >
                {t('timer.removeMinute')}
              </Button>
              <Button variant="default" onClick={() => setResetting(true)}>
                {t('timer.reset')}
              </Button>
            </Group>
          </>
        )}
      </Stack>
      {resetting && (
        <Modal opened onClose={() => setResetting(false)} title={t('timer.resetModal.title')}>
          <Stack>
            <Text>{t('timer.resetModal.body')}</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setResetting(false)}>
                {t('timer.resetModal.cancel')}
              </Button>
              <Button
                color="red"
                onClick={() => {
                  setResetting(false);
                  update(null);
                }}
              >
                {t('timer.resetModal.confirm')}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Card>
  );
}
