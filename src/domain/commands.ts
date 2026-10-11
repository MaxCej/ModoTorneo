import { z } from 'zod';
import { domainError, type DomainError } from './errors';
import { newId } from './ids';
import { apply, reduce } from './reduce';
import { err, ok, type Result } from './result';
import type { IsoDateTime, Uuid } from './schemas/common';
import type { TournamentDocument } from './schemas/document';
import {
  TournamentEventSchema,
  type EventPayload,
  type TournamentCreatedPayload,
  type TournamentEvent,
  type TournamentEventType,
} from './schemas/events';
import type { TournamentState } from './state';
import { validate } from './validate';

/** One command per event type: the event without its envelope. */
export type Command = {
  [T in TournamentEventType]: { type: T; payload: EventPayload<T> };
}[TournamentEventType];

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
  const candidate = { id: deps.newId(), seq, at: deps.now(), type: cmd.type, payload: cmd.payload };
  const parsed = TournamentEventSchema.safeParse(candidate);
  if (!parsed.success) {
    return err(domainError('INVALID_SCHEMA', z.prettifyError(parsed.error), seq));
  }
  return ok(parsed.data);
}
