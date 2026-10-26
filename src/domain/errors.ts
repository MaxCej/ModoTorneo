export type DomainErrorCode =
  | 'INVALID_SCHEMA'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'FIRST_EVENT_NOT_CREATED'
  | 'DUPLICATE_CREATED'
  | 'SEQ_GAP'
  | 'WRONG_STATUS'
  | 'DUPLICATE_PLAYER'
  | 'UNKNOWN_PLAYER'
  | 'PLAYER_DROPPED'
  | 'ROUND_OUT_OF_ORDER'
  | 'ROUND_STILL_OPEN'
  | 'TOO_MANY_ROUNDS'
  | 'INVALID_PAIRINGS'
  | 'UNKNOWN_MATCH'
  | 'ROUND_CLOSED'
  | 'BYE_RESULT'
  | 'MISSING_RESULTS'
  | 'TOP_CUT_DRAW'
  | 'INVALID_ROLLBACK_TARGET'
  | 'INVALID_DETAILS'
  | 'INVALID_SWAP'
  | 'NO_OPEN_ROUND'
  | 'RESULT_EXCEEDS_BEST_OF'
  | 'INVALID_DECK';

export type DomainError = { code: DomainErrorCode; message: string; seq?: number };

export function domainError(code: DomainErrorCode, message: string, seq?: number): DomainError {
  return seq === undefined ? { code, message } : { code, message, seq };
}

/** Thrown by the reducer when a stored log breaks an invariant. */
export class CorruptLogError extends Error {
  readonly error: DomainError;

  constructor(error: DomainError) {
    super(`Corrupt tournament log: ${error.code}: ${error.message}`);
    this.name = 'CorruptLogError';
    this.error = error;
  }
}
