import { describe, expect, it } from 'vitest';
import { CREATED_PAYLOAD, TOURNAMENT_ID, event } from './fixtures/builders';
import type { TournamentCreated } from './schemas/events';
import { initialState } from './state';

describe('initialState', () => {
  it('copies the metadata and starts in setup with no players or rounds', () => {
    const created = event(1, 'TournamentCreated', CREATED_PAYLOAD) as TournamentCreated;

    expect(initialState(TOURNAMENT_ID, created)).toEqual({
      id: TOURNAMENT_ID,
      ...CREATED_PAYLOAD,
      topCut: null,
      status: 'setup',
      players: {},
      rounds: [],
      lastSeq: 1,
      voidedSeqs: [],
    });
  });
});
