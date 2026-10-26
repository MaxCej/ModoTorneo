import { countPlayed, type GameCounts, type MatchCounts } from './playerStats';
import type { Uuid } from './schemas/common';
import type { TournamentState } from './state';

/** Players of one archetype in one tournament. */
export type ArchetypeEntry = {
  archetype: string | null; // null: players without an archetype ("Unknown")
  players: number; // registered with it, guests and dropped included
  topCut: number; // of those, players in at least one top cut match
};

/** Matches between two archetypes, from `archetype`'s side. */
export type Matchup = MatchCounts & {
  archetype: string | null;
  opponent: string | null;
  games: GameCounts;
};

/** One tournament's metagame. Stored in the tournament summary. */
export type TournamentMetagame = {
  archetypes: ArchetypeEntry[]; // name order (English collation), Unknown last
  matchups: Matchup[]; // one row per ordered pair that met; each match is counted from both sides
};

const collator = new Intl.Collator('en');

/** Name order, Unknown (`null`) last. */
function compareLabels(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  return collator.compare(a, b);
}

/**
 * Archetype entries and matchups of every registered player, guests and dropped players
 * included. Labels are grouped case-insensitively with the first spelling in registration
 * order. Swiss and top cut matches with a result count; byes and unplayed matches do not.
 */
export function tournamentMetagame(state: TournamentState): TournamentMetagame {
  const spellings = new Map<string, string>();
  const archetypeOf = new Map<Uuid, string | null>();
  for (const player of Object.values(state.players)) {
    const label = player.deck?.archetype;
    if (label === undefined) {
      archetypeOf.set(player.playerId, null);
      continue;
    }
    const key = label.toLowerCase();
    const spelling = spellings.get(key) ?? label;
    spellings.set(key, spelling);
    archetypeOf.set(player.playerId, spelling);
  }

  const inTopCut = new Set<Uuid>();
  const matchups = new Map<string, Matchup>();
  for (const round of state.rounds) {
    for (const match of round.matches) {
      if (round.stage === 'topCut') {
        inTopCut.add(match.playerA);
        if (match.playerB !== null) {
          inTopCut.add(match.playerB);
        }
      }
      const { playerB, result } = match;
      if (playerB === null || result === null || result.kind === 'unplayed') {
        continue;
      }
      for (const side of ['A', 'B'] as const) {
        const archetype = archetypeOf.get(side === 'A' ? match.playerA : playerB) ?? null;
        const opponent = archetypeOf.get(side === 'A' ? playerB : match.playerA) ?? null;
        const key = JSON.stringify([archetype, opponent]);
        let matchup = matchups.get(key);
        if (matchup === undefined) {
          matchup = {
            archetype,
            opponent,
            wins: 0,
            losses: 0,
            draws: 0,
            games: { won: 0, lost: 0, drawn: 0 },
          };
          matchups.set(key, matchup);
        }
        countPlayed(matchup, match, side);
      }
    }
  }

  const entries = new Map<string | null, ArchetypeEntry>();
  for (const [playerId, archetype] of archetypeOf) {
    let entry = entries.get(archetype);
    if (entry === undefined) {
      entry = { archetype, players: 0, topCut: 0 };
      entries.set(archetype, entry);
    }
    entry.players += 1;
    if (inTopCut.has(playerId)) {
      entry.topCut += 1;
    }
  }

  return {
    archetypes: [...entries.values()].sort((a, b) => compareLabels(a.archetype, b.archetype)),
    matchups: [...matchups.values()].sort(
      (a, b) => compareLabels(a.archetype, b.archetype) || compareLabels(a.opponent, b.opponent),
    ),
  };
}
