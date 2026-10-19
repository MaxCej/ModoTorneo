import type { BestOf, Format, IsoDate, TopCutSize, Uuid } from './schemas/common';
import type { Pairing, TournamentCreated } from './schemas/events';
import { matchOutcome, type MatchResult } from './schemas/matchResult';

export type TournamentStatus = 'setup' | 'running' | 'topCut' | 'finished';

export type PlayerEntry = {
  playerId: Uuid;
  playerName: string;
  deckId?: Uuid;
  guest: boolean; // false when the event omits it
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
  swissRounds: number | null; // null until fixed by the first swiss RoundPaired, or set by the organizer
  topCut: TopCutSize | null; // null until TopCutStarted
  topCutBestOf: BestOf | null; // null until TopCutStarted; missing bestOf = 3
  status: TournamentStatus;
  players: Record<Uuid, PlayerEntry>;
  rounds: Round[];
  lastSeq: number; // highest seq in the log, including voided events
  voidedSeqs: number[]; // seqs cancelled by RolledBack, ascending
  effectiveSeqs: number[]; // seqs of effective events (valid rollback targets up to lastSeq), ascending
};

/** Registered players who have not dropped. */
export function activePlayerCount(state: TournamentState): number {
  return Object.values(state.players).filter((player) => !player.dropped).length;
}

/** The winner of a reported match with a winner, otherwise `null` (unreported, draw or bye). */
export function matchWinner(match: Match): Uuid | null {
  if (match.result === null || match.playerB === null) {
    return null;
  }
  const outcome = matchOutcome(match.result);
  return outcome === 'A' ? match.playerA : outcome === 'B' ? match.playerB : null;
}

/** Builds the initial state from the log's first event. */
export function initialState(tournamentId: Uuid, event: TournamentCreated): TournamentState {
  return {
    id: tournamentId,
    ...event.payload,
    topCut: null,
    topCutBestOf: null,
    status: 'setup',
    players: {},
    rounds: [],
    lastSeq: event.seq,
    voidedSeqs: [],
    effectiveSeqs: [event.seq],
  };
}
