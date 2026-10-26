import { Text } from '@mantine/core';
import type { Deck } from '../../domain';

/** The deck's archetype as dimmed small text, or nothing without one. */
export function Archetype({ deck }: { deck: Deck | null }) {
  if (deck?.archetype === undefined) {
    return null;
  }
  return (
    <Text size="xs" c="dimmed">
      {deck.archetype}
    </Text>
  );
}
