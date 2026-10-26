import { useSyncExternalStore } from 'react';

// The time-up beep (SPEC 13): three short tones through Web Audio, no sound file. A window
// opened by a script has no user gesture, so its AudioContext starts suspended until a click
// calls `unlockSound`. Where AudioContext does not exist (jsdom), everything is a no-op.

const TONE_HZ = 880;
const TONE_S = 0.15;
const GAP_S = 0.1;
const TONES = 3;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') {
    return null;
  }
  context ??= new AudioContext();
  return context;
}

/** Resumes audio. Call from a click: browsers allow it only after a user gesture. */
export function unlockSound(): void {
  void audioContext()
    ?.resume()
    .catch(() => {});
}

export function playBeep(): void {
  const audio = audioContext();
  if (audio === null) {
    return;
  }
  void audio.resume().catch(() => {});
  const start = audio.currentTime;
  for (let i = 0; i < TONES; i += 1) {
    const at = start + i * (TONE_S + GAP_S);
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = TONE_HZ;
    // Short ramps avoid clicks at both ends of each tone.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.3, at + 0.01);
    gain.gain.linearRampToValueAtTime(0, at + TONE_S);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + TONE_S);
  }
}

function subscribe(onChange: () => void): () => void {
  const audio = audioContext();
  audio?.addEventListener('statechange', onChange);
  return () => audio?.removeEventListener('statechange', onChange);
}

function isBlocked(): boolean {
  return context?.state === 'suspended';
}

/** True while the browser holds audio until a user gesture. */
export function useSoundBlocked(): boolean {
  return useSyncExternalStore(subscribe, isBlocked, () => false);
}
