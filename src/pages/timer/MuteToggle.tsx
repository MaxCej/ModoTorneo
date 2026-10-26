import { ActionIcon, Button, Group } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readMuted, writeMuted, type TimerView } from '../../storage/timerStorage';
import { unlockSound, useSoundBlocked } from './beep';

/** The view's mute toggle, remembered in `localStorage`. One per view type. */
export function useMuted(view: TimerView): [boolean, (muted: boolean) => void] {
  const [muted, setMuted] = useState(() => readMuted(view));
  return [
    muted,
    (next: boolean) => {
      writeMuted(view, next);
      setMuted(next);
    },
  ];
}

type Props = {
  muted: boolean;
  onChange: (muted: boolean) => void;
  /** Offer "Enable sound" when the browser holds audio (only where a beep can come). */
  offerUnlock: boolean;
};

/** Mute button, plus "Enable sound" while the browser blocks audio and the view is not muted. */
export function MuteToggle({ muted, onChange, offerUnlock }: Props) {
  const { t } = useTranslation();
  const blocked = useSoundBlocked();
  return (
    <Group gap="xs">
      {offerUnlock && blocked && !muted && (
        <Button size="xs" variant="light" onClick={unlockSound}>
          {t('timer.enableSound')}
        </Button>
      )}
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={muted ? t('timer.unmute') : t('timer.mute')}
        aria-pressed={muted}
        onClick={() => onChange(!muted)}
      >
        <SpeakerIcon muted={muted} />
      </ActionIcon>
    </Group>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      {muted ? (
        <path d="m23 9-6 6M17 9l6 6" />
      ) : (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
      )}
    </svg>
  );
}
