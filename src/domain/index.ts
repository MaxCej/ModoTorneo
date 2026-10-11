// Public API of the domain layer. `apply`, `validate` and `initialState` stay internal:
// callers go through `execute`, `createTournament`, `reduce` and `parseTournamentDocument`.
export * from './schemas/common';
export * from './schemas/document';
export * from './schemas/events';
export * from './schemas/matchResult';
export * from './schemas/player';

export { createTournament, execute, type Command, type Deps, type ExecuteResult } from './commands';
export { parseTournamentDocument } from './document';
export { CorruptLogError, type DomainError, type DomainErrorCode } from './errors';
export { newId } from './ids';
export { effectiveEvents, reduce, stateAt } from './reduce';
export { err, ok, type Result } from './result';
export type { Match, PlayerEntry, Round, TournamentState, TournamentStatus } from './state';
