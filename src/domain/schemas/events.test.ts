import { describe, expect, it } from 'vitest';
import { TournamentEventSchema, type TournamentEventType } from './events';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const M1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const envelope = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  seq: 1,
  at: '2026-10-11T18:30:00.000Z',
};

type Sample = { valid: unknown; invalid: Record<string, unknown> };

const samples: Record<TournamentEventType, Sample> = {
  TournamentCreated: {
    valid: {
      name: 'Friday Night Magic',
      date: '2026-10-11',
      location: 'Local store',
      format: 'modern',
      swissRounds: 3,
    },
    invalid: {
      'unknown format': {
        name: 'FNM',
        date: '2026-10-11',
        location: '',
        format: 'brawl',
        swissRounds: 3,
      },
      'zero swiss rounds': {
        name: 'FNM',
        date: '2026-10-11',
        location: '',
        format: 'modern',
        swissRounds: 0,
      },
      'blank name': {
        name: '  ',
        date: '2026-10-11',
        location: '',
        format: 'modern',
        swissRounds: 3,
      },
    },
  },
  PlayerRegistered: {
    valid: { playerId: P1, playerName: 'Alice', deckId: M1 },
    invalid: {
      'missing playerName': { playerId: P1 },
      'invalid deckId': { playerId: P1, playerName: 'Alice', deckId: 'burn' },
    },
  },
  PlayerDropped: {
    valid: { playerId: P1 },
    invalid: { 'invalid playerId': { playerId: 'alice' } },
  },
  RoundPaired: {
    valid: {
      round: 1,
      stage: 'swiss',
      pairings: [
        { matchId: M1, table: 1, playerA: P1, playerB: P2 },
        { matchId: M2, table: 2, playerA: P3, playerB: null },
      ],
    },
    invalid: {
      'unknown stage': { round: 1, stage: 'finals', pairings: [] },
      'table 0': {
        round: 1,
        stage: 'swiss',
        pairings: [{ matchId: M1, table: 0, playerA: P1, playerB: P2 }],
      },
      'round 0': { round: 0, stage: 'swiss', pairings: [] },
    },
  },
  ResultReported: {
    valid: { matchId: M1, result: { winsA: 2, winsB: 1, draws: 0, kind: 'played' } },
    invalid: {
      'invalid result': { matchId: M1, result: { winsA: 0, winsB: 0, draws: 0, kind: 'played' } },
    },
  },
  RoundClosed: {
    valid: { round: 1 },
    invalid: { 'non-integer round': { round: 1.5 } },
  },
  TopCutStarted: {
    valid: { size: 16 },
    invalid: { 'size 0': { size: 0 }, 'size 6': { size: 6 } },
  },
  TournamentFinished: {
    valid: {},
    invalid: { 'non-empty payload': { winner: P1 } },
  },
  RolledBack: {
    valid: { toSeq: 5 },
    invalid: { 'toSeq 0': { toSeq: 0 } },
  },
};

describe('TournamentEventSchema', () => {
  describe.each(Object.entries(samples))('%s', (type, { valid, invalid }) => {
    it('parses a valid sample', () => {
      const event = { ...envelope, type, payload: valid };
      expect(TournamentEventSchema.parse(event)).toEqual(event);
    });

    it.each(Object.entries(invalid))('rejects %s', (_, payload) => {
      expect(TournamentEventSchema.safeParse({ ...envelope, type, payload }).success).toBe(false);
    });
  });

  it('rejects an unknown type', () => {
    expect(
      TournamentEventSchema.safeParse({ ...envelope, type: 'MatchDeleted', payload: {} }).success,
    ).toBe(false);
  });

  it('rejects a payload that belongs to another type', () => {
    expect(
      TournamentEventSchema.safeParse({ ...envelope, type: 'RoundClosed', payload: { toSeq: 1 } })
        .success,
    ).toBe(false);
  });

  it.each([
    ['seq 0', { seq: 0 }],
    ['non-integer seq', { seq: 1.5 }],
    ['invalid id', { id: 'evt-1' }],
    ['non-UTC at', { at: '2026-10-11T15:30:00.000-03:00' }],
  ])('rejects an envelope with %s', (_, override) => {
    const event = { ...envelope, type: 'RoundClosed', payload: { round: 1 }, ...override };
    expect(TournamentEventSchema.safeParse(event).success).toBe(false);
  });
});
