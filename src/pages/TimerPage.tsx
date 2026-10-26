import { Box, Center, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { roundTimer } from '../storage/timerStorage';
import { playBeep } from './timer/beep';
import { Clock } from './timer/Clock';
import { MuteToggle, useMuted } from './timer/MuteToggle';
import { roundLabel } from './timer/roundLabel';
import { useClock } from './timer/useClock';
import { useTimerRecord } from './timer/useTimerRecord';

const CLOCK_SIZE = 'clamp(4rem, 22vw, 40rem)';
const LABEL_SIZE = 'clamp(1.5rem, 5vw, 6rem)';

/**
 * The big timer for a projector (SPEC 13), outside the app layout. Read-only: it shows the
 * timer record the tournament page keeps in `localStorage` and never loads the tournament.
 */
export function TimerPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [record] = useTimerRecord(id ?? '');
  const [muted, setMuted] = useMuted('bigView');
  const openRound = record?.openRound ?? null;
  const timer = openRound === null ? null : roundTimer(record, openRound.round);
  const remaining = useClock(timer, {
    round: openRound?.round,
    onTimeUp: () => {
      if (!muted) {
        playBeep();
      }
    },
  });

  return (
    <Box mih="100vh" p="md" pos="relative">
      <Box pos="absolute" top={16} right={16}>
        <MuteToggle muted={muted} onChange={setMuted} offerUnlock />
      </Box>
      <Center mih="calc(100vh - 2 * var(--mantine-spacing-md))">
        {record === null ? (
          <Text size="xl">{t('timer.bigView.noRecord')}</Text>
        ) : (
          <Stack align="center" gap="md">
            <Title order={1} ta="center">
              {record.tournamentName}
            </Title>
            {openRound === null ? (
              <Text fz={LABEL_SIZE} c="dimmed" ta="center">
                {t('timer.bigView.waiting')}
              </Text>
            ) : (
              <>
                <Text fz="clamp(1.25rem, 3vw, 3rem)" fw={600}>
                  {roundLabel(t, openRound)}
                </Text>
                {timer === null || remaining === null ? (
                  <Text fz={LABEL_SIZE} c="dimmed">
                    {t('timer.notStarted')}
                  </Text>
                ) : (
                  <Clock
                    remaining={remaining}
                    paused={timer.kind === 'paused'}
                    size={CLOCK_SIZE}
                    labelSize={LABEL_SIZE}
                  />
                )}
              </>
            )}
          </Stack>
        )}
      </Center>
    </Box>
  );
}
