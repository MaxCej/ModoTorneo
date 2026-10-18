// Public API of the domain layer. `apply`, `validate` and `initialState` stay internal:
// callers go through `execute`, `createTournament`, `reduce` and `parseTournamentDocument`.
export * from './schemas/common';
export { DatasetSchema, type Dataset } from './schemas/dataset';
export * from './schemas/document';
export * from './schemas/events';
export * from './schemas/matchResult';
export * from './schemas/player';

export { createTournament, execute, type Command, type Deps, type ExecuteResult } from './commands';
export { parseTournamentDocument } from './document';
export { CorruptLogError, type DomainError, type DomainErrorCode } from './errors';
export { newId } from './ids';
export { parseImportFile, type ParsedImport } from './importFile';
export { compareLogs, playersFromDocument, type LogComparison } from './merge';
export {
  pairingWarnings,
  pairSwissRound,
  SEARCH_BUDGET,
  type PairingDeps,
  type PairingWarning,
} from './pairing';
export { matchPoints, playerRecords, type PlayerRecord } from './points';
export { effectiveEvents, reduce, stateAt } from './reduce';
export { err, ok, type Result } from './result';
export {
  activePlayerCount,
  type Match,
  type PlayerEntry,
  type Round,
  type TournamentState,
  type TournamentStatus,
} from './state';
export { editableDetails, resolvedSwissRounds, type DetailField } from './validate';
export {
  SWISS_ROUNDS_TABLE,
  recommendedSwissRounds,
  recommendedSwissRoundsTop8,
} from './swissRounds';
