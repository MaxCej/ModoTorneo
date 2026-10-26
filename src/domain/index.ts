// Public API of the domain layer. `apply`, `validate` and `initialState` stay internal:
// callers go through `execute`, `createTournament`, `reduce` and `parseTournamentDocument`.
export * from './schemas/common';
export { DatasetSchema, type Dataset } from './schemas/dataset';
export * from './schemas/deck';
export * from './schemas/document';
export * from './schemas/events';
export * from './schemas/matchResult';
export * from './schemas/player';
export * from './schemas/playersFile';

export {
  createTournament,
  execute,
  executeAll,
  type Command,
  type Deps,
  type ExecuteAllResult,
  type ExecuteResult,
} from './commands';
export {
  archetypeSuggestions,
  canonicalArchetype,
  cardCount,
  formatDecklist,
  parseDecklist,
  tournamentArchetypes,
  type ParsedDecklist,
} from './decklist';
export { parseTournamentDocument } from './document';
export { CorruptLogError, type DomainError, type DomainErrorCode } from './errors';
export {
  historyOf,
  rollbackPreview,
  type History,
  type HistoryEntry,
  type MatchRef,
  type RollbackPreview,
} from './history';
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
export {
  playerProfile,
  playerResults,
  playerTotals,
  type GameCounts,
  type MatchCounts,
  type PlayerHistoryRow,
  type PlayerProfile,
  type PlayerResult,
  type PlayerTotals,
  type TournamentResults,
} from './playerStats';
export { matchPoints, playerRecords, type PlayerRecord } from './points';
export { redoPairingCommands, type RedoPairings } from './redoPairings';
export { effectiveEvents, reduce, stateAt } from './reduce';
export { err, ok, type Result } from './result';
export { lastClosedSwissRound, PERCENTAGE_FLOOR, standings, type Standing } from './standings';
export {
  activePlayerCount,
  matchWinner,
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
export {
  bracketOrder,
  defaultTopCutSize,
  pairTopCutRound,
  seedPreview,
  startTopCutCommands,
  topCutBracket,
  topCutPlacings,
  topCutRoundName,
  topCutSeeds,
  type Bracket,
  type BracketMatch,
  type BracketPlayer,
  type BracketRound,
  type Placing,
  type SeedCandidate,
  type SeedPreview,
  type TopCutRoundName,
} from './topCut';
