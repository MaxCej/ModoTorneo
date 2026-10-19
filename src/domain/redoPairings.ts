import { executeAll, type Command, type Deps } from './commands';
import { domainError, type DomainError } from './errors';
import { newId } from './ids';
import { pairSwissRound, type PairingDeps } from './pairing';
import { effectiveEvents, reduce } from './reduce';
import { err, ok, type Result } from './result';
import type { TournamentDocument } from './schemas/document';

export type RedoPairings = {
  commands: [Command, ...Command[]]; // RolledBack, carried events, RoundPaired
  round: number;
  voidedResults: number; // ResultReported events voided
  voidedSwaps: number; // PlayersSwapped events voided
  carried: number; // events re-appended
};

const defaultDeps: Deps & PairingDeps = {
  now: () => new Date().toISOString(),
  newId,
  random: Math.random,
};

/** Events made during the round that survive a redo. */
const CARRIED_TYPES = new Set(['PlayerRegistered', 'PlayerDropped', 'TournamentDetailsChanged']);

/**
 * Builds the commands that re-pair the open swiss round.
 * Errors: NO_OPEN_ROUND when the last round is closed, is a top cut round, or no round exists;
 * any pairSwissRound or validation error otherwise.
 */
export function redoPairingCommands(
  doc: TournamentDocument,
  deps: Deps & PairingDeps = defaultDeps,
): Result<RedoPairings, DomainError> {
  const state = reduce(doc.events, doc.id);
  const open = state.rounds.at(-1);
  if (open === undefined || open.closed || open.stage !== 'swiss') {
    return err(domainError('NO_OPEN_ROUND', 'There is no open swiss round to pair again'));
  }

  const effective = effectiveEvents(doc.events);
  const pairedAt = effective.findLastIndex(
    (event) => event.type === 'RoundPaired' && event.payload.round === open.number,
  );
  // Seq 1 is always TournamentCreated, so an effective event precedes the RoundPaired.
  const toSeq = effective[pairedAt - 1].seq;
  const during = effective.slice(pairedAt + 1);

  const carried = during
    .filter((event) => CARRIED_TYPES.has(event.type))
    .map((event) => ({ type: event.type, payload: event.payload }) as Command);
  const prefix: [Command, ...Command[]] = [{ type: 'RolledBack', payload: { toSeq } }, ...carried];

  // The new pairing runs on the state after the rollback and the carried events.
  const replayed = executeAll(doc, prefix, deps);
  if (!replayed.ok) {
    return replayed;
  }
  const paired = pairSwissRound(replayed.value.state, deps);
  if (!paired.ok) {
    return paired;
  }

  return ok({
    commands: [...prefix, { type: 'RoundPaired', payload: paired.value }],
    round: paired.value.round,
    voidedResults: during.filter((event) => event.type === 'ResultReported').length,
    voidedSwaps: during.filter((event) => event.type === 'PlayersSwapped').length,
    carried: carried.length,
  });
}
