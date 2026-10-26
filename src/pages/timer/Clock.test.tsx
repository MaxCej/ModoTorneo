import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Clock, formatClock } from './Clock';

describe('formatClock', () => {
  it('shows MM:SS under one hour and H:MM:SS from one hour', () => {
    expect(formatClock(50 * 60_000)).toBe('50:00');
    expect(formatClock(59_000)).toBe('00:59');
    expect(formatClock(60 * 60_000)).toBe('1:00:00');
    expect(formatClock(2 * 3_600_000 + 5 * 60_000 + 9_000)).toBe('2:05:09');
  });

  it('rounds a countdown up', () => {
    expect(formatClock(50 * 60_000 - 200)).toBe('50:00');
    expect(formatClock(58_001)).toBe('00:59');
    expect(formatClock(1)).toBe('00:01');
  });

  it('shows overtime from zero, rounded down, with a plus', () => {
    expect(formatClock(0)).toBe('+00:00');
    expect(formatClock(-999)).toBe('+00:00');
    expect(formatClock(-125_900)).toBe('+02:05');
    expect(formatClock(-3_600_000)).toBe('+1:00:00');
  });
});

describe('Clock', () => {
  function renderClock(remaining: number, paused = false) {
    render(
      <MantineProvider env="test">
        <Clock remaining={remaining} paused={paused} size="48px" />
      </MantineProvider>,
    );
  }

  it('shows the countdown with no label', () => {
    renderClock(90_000);
    expect(screen.getByTestId('timer-clock')).toHaveTextContent('01:30');
    expect(screen.queryByText('Time')).not.toBeInTheDocument();
    expect(screen.queryByText('Paused')).not.toBeInTheDocument();
  });

  it('shows "Time" in overtime', () => {
    renderClock(-5_000);
    expect(screen.getByTestId('timer-clock')).toHaveTextContent('+00:05');
    expect(screen.getByText('Time')).toBeInTheDocument();
  });

  it('shows "Paused" when paused', () => {
    renderClock(90_000, true);
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });
});
