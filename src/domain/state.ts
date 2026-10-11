import type { Format, IsoDate, TopCutSize, Uuid } from './schemas/common';
import type { Pairing, TournamentCreated } from './schemas/events';
import type { MatchResult } from './schemas/matchResult';

export type TournamentStatus = 'setup' | 'running' | 'topCut' | 'finished';

export type PlayerEntry = {
  playerId: Uuid;
  playerName: string;
  deckId?: Uuid;
  dropped: boolean;
  registeredAtRound: number; // 0 = before round 1
};

export type Match = Pairing & { result: MatchResult | null };

export type Round = {
  number: number;
  stage: 'swiss' | 'topCut';
  closed: boolean;
  matches: Match[];
};

export type TournamentState = {
  id: Uuid;
  name: string;
  date: IsoDate;
  location: string;
  format: Format;
  swissRounds: number;
  topCut: TopCutSize | null; // null until TopCutStarted
  status: TournamentStatus;
  players: Record<Uuid, PlayerEntry>;
  rounds: Round[];
  lastSeq: number; // highest seq in the log, including voided events
  voidedSeqs: number[]; // seqs cancelled by RolledBack, ascending
  effectiveSeqs: number[]; // seqs of effective events (valid rollback targets up to lastSeq), ascending
};

/** Builds the initial state from the log's first event. */
export function initialState(tournamentId: Uuid, event: TournamentCreated): TournamentState {
  return {
    id: tournamentId,
    ...event.payload,
    topCut: null,
    status: 'setup',
    players: {},
    rounds: [],
    lastSeq: event.seq,
    voidedSeqs: [],
    effectiveSeqs: [event.seq],
  };
}
