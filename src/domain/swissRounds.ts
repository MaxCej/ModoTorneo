/**
 * Recommended swiss rounds by player count, based on MTR Appendix E.
 * `max: null` = no upper bound. `roundsTop8: null` = too few players for a Top 8.
 */
export const SWISS_ROUNDS_TABLE: ReadonlyArray<{
  min: number;
  max: number | null;
  rounds: number;
  roundsTop8: number | null;
}> = [
  { min: 2, max: 2, rounds: 1, roundsTop8: null },
  { min: 3, max: 4, rounds: 2, roundsTop8: null },
  { min: 5, max: 8, rounds: 3, roundsTop8: null },
  { min: 9, max: 16, rounds: 4, roundsTop8: 5 },
  { min: 17, max: 32, rounds: 5, roundsTop8: 5 },
  { min: 33, max: 64, rounds: 6, roundsTop8: 6 },
  { min: 65, max: 128, rounds: 7, roundsTop8: 7 },
  { min: 129, max: 226, rounds: 8, roundsTop8: 8 },
  { min: 227, max: 409, rounds: 9, roundsTop8: 9 },
  { min: 410, max: null, rounds: 10, roundsTop8: 10 },
];

function rowFor(players: number) {
  return SWISS_ROUNDS_TABLE.find(
    (row) => players >= row.min && (row.max === null || players <= row.max),
  );
}

/** Swiss rounds without a top cut. `null` when `players < 2`. */
export function recommendedSwissRounds(players: number): number | null {
  return rowFor(players)?.rounds ?? null;
}

/** Swiss rounds before a Top 8. `null` when `players < 9`. */
export function recommendedSwissRoundsTop8(players: number): number | null {
  return rowFor(players)?.roundsTop8 ?? null;
}
