import { z } from 'zod';
import { domainError, type DomainError } from './errors';
import { newId } from './ids';
import { apply, reduce } from './reduce';
import { err, ok, type Result } from './result';
import type { IsoDateTime, Uuid } from './schemas/common';
import type { TournamentDocument } from './schemas/document';
import {
  TournamentEventSchema,
  type DeckSetPayload,
  type EventPayload,
  type TournamentCreatedPayload,
  type TournamentEvent,
  type TournamentEventType,
} from './schemas/events';
import type { TournamentState } from './state';
import { validate } from './validate';

/** Event types whose command has the same name. */
type SameNameType = Exclude<TournamentEventType, 'DeckSet'>;

/**
 * One command per event type: the event without its envelope.
 * `SetDeck` is appended as `DeckSet`; every other command keeps its event's name.
 */
export type Command =
  | { [T in SameNameType]: { type: T; payload: EventPayload<T> } }[SameNameType]
  | { type: 'SetDeck'; payload: DeckSetPayload };

/** The command that appends an event with this payload again (used to carry events). */
export function commandOf(event: TournamentEvent): Command {
  return event.type === 'DeckSet'
    ? { type: 'SetDeck', payload: event.payload }
    : ({ type: event.type, payload: event.payload } as Command);
}

export type Deps = { now: () => IsoDateTime; newId: () => Uuid };

const defaultDeps: Deps = { now: () => new Date().toISOString(), newId };

export type ExecuteResult = {
  doc: TournamentDocument;
  state: TournamentState;
  event: TournamentEvent;
};

/**
 * Wraps a command in an envelope, checks it against the event schema and the invariants,
 * and returns a new document with the event appended. Never mutates `doc`.
 * The stored event is the schema-parsed one (e.g. names trimmed).
 */
export function execute(
  doc: TournamentDocument,
  cmd: Command,
  deps: Deps = defaultDeps,
): Result<ExecuteResult, DomainError> {
  const current = reduce(doc.events, doc.id);
  const parsed = parseEvent(cmd, current.lastSeq + 1, deps);
  if (!parsed.ok) {
    return parsed;
  }
  const event = parsed.value;
  const error = validate(current, event);
  if (error !== null) {
    return err(error);
  }
  const events = [...doc.events, event];
  // RolledBack needs earlier states, which only a full replay has.
  const state =
    event.type === 'RolledBack' ? reduce(events, doc.id) : apply(current, event, doc.id);
  return ok({ doc: { ...doc, events }, state, event });
}

export type ExecuteAllResult = {
  doc: TournamentDocument;
  state: TournamentState;
  events: TournamentEvent[]; // the appended events, in order
};

/**
 * Executes the commands in order, each on the document produced by the previous one.
 * Returns the final document and state, or the first error. On error nothing is appended.
 */
export function executeAll(
  doc: TournamentDocument,
  commands: readonly [Command, ...Command[]],
  deps: Deps = defaultDeps,
): Result<ExecuteAllResult, DomainError> {
  let current = doc;
  let state: TournamentState | null = null;
  const events: TournamentEvent[] = [];
  for (const cmd of commands) {
    const result = execute(current, cmd, deps);
    if (!result.ok) {
      return result;
    }
    ({ doc: current, state } = result.value);
    events.push(result.value.event);
  }
  // The tuple type guarantees at least one command, so `state` is set.
  return ok({ doc: current, state: state as TournamentState, events });
}

/** Starts a new tournament document. The tournament id is drawn before the event id. */
export function createTournament(
  payload: TournamentCreatedPayload,
  deps: Deps = defaultDeps,
): Result<{ doc: TournamentDocument; state: TournamentState }, DomainError> {
  const id = deps.newId();
  const parsed = parseEvent({ type: 'TournamentCreated', payload }, 1, deps);
  if (!parsed.ok) {
    return parsed;
  }
  const events = [parsed.value];
  return ok({ doc: { schemaVersion: 1, id, events }, state: reduce(events, id) });
}

function parseEvent(cmd: Command, seq: number, deps: Deps): Result<TournamentEvent, DomainError> {
  const type = cmd.type === 'SetDeck' ? 'DeckSet' : cmd.type;
  const candidate = { id: deps.newId(), seq, at: deps.now(), type, payload: cmd.payload };
  const parsed = TournamentEventSchema.safeParse(candidate);
  if (!parsed.success) {
    return err(domainError('INVALID_SCHEMA', z.prettifyError(parsed.error), seq));
  }
  return ok(parsed.data);
}
