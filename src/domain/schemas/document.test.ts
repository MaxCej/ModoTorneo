import { describe, expect, it } from 'vitest';
import { TournamentDocumentSchema } from './document';

const doc = {
  schemaVersion: 1,
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  events: [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      seq: 1,
      at: '2026-10-11T18:30:00.000Z',
      type: 'TournamentCreated',
      payload: {
        name: 'Friday Night Magic',
        date: '2026-10-11',
        location: '',
        format: 'pauper',
        swissRounds: 3,
        topCut: 0,
      },
    },
  ],
};

describe('TournamentDocumentSchema', () => {
  it('parses a valid document', () => {
    expect(TournamentDocumentSchema.parse(doc)).toEqual(doc);
  });

  it.each([0, 2, '1'])('rejects schemaVersion %s', (schemaVersion) => {
    expect(TournamentDocumentSchema.safeParse({ ...doc, schemaVersion }).success).toBe(false);
  });

  it('rejects a document with an invalid event', () => {
    const events = [{ ...doc.events[0], type: 'Unknown' }];
    expect(TournamentDocumentSchema.safeParse({ ...doc, events }).success).toBe(false);
  });

  it('rejects a document without events', () => {
    expect(TournamentDocumentSchema.safeParse({ ...doc, events: undefined }).success).toBe(false);
  });
});
