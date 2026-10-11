import { effectiveEvents } from './reduce';
import type { TournamentDocument } from './schemas/document';
import type { TournamentEvent } from './schemas/events';
import type { Player } from './schemas/player';
import type { TournamentState } from './state';

export type LogComparison = 'identical' | 'incomingAhead' | 'localAhead' | 'diverged';

/** Structural equality of plain JSON values. Object key order does not matter. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => deepEqual(item, b[i]))
    );
  }
  const aEntries = Object.entries(a).filter(([, value]) => value !== undefined);
  const bRecord = b as Record<string, unknown>;
  const bSize = Object.values(bRecord).filter((value) => value !== undefined).length;
  return (
    aEntries.length === bSize && aEntries.every(([key, value]) => deepEqual(value, bRecord[key]))
  );
}

/**
 * Compares two logs of the same tournament, event by event, in order.
 * `incomingAhead`: local is a strict prefix of incoming. `localAhead`: the reverse.
 */
export function compareLogs(
  local: readonly TournamentEvent[],
  incoming: readonly TournamentEvent[],
): LogComparison {
  const common = Math.min(local.length, incoming.length);
  for (let i = 0; i < common; i++) {
    if (!deepEqual(local[i], incoming[i])) {
      return 'diverged';
    }
  }
  if (local.length === incoming.length) {
    return 'identical';
  }
  return local.length < incoming.length ? 'incomingAhead' : 'localAhead';
}

/**
 * One global `Player` per registered player, named from the registration snapshot.
 * `createdAt` is the `at` of the effective `PlayerRegistered` event (voided ones are ignored).
 */
export function playersFromDocument(doc: TournamentDocument, state: TournamentState): Player[] {
  const registeredAt = new Map<string, string>();
  for (const event of effectiveEvents(doc.events)) {
    if (event.type === 'PlayerRegistered') {
      registeredAt.set(event.payload.playerId, event.at);
    }
  }
  return Object.values(state.players).flatMap((entry) => {
    const createdAt = registeredAt.get(entry.playerId);
    return createdAt === undefined
      ? []
      : [{ id: entry.playerId, name: entry.playerName, createdAt }];
  });
}
