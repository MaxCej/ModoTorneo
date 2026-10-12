import { describe, expect, it } from 'vitest';
import { createTournament } from './commands';
import { CREATED_PAYLOAD, TOURNAMENT_ID, uuid } from './fixtures/builders';
import fixture from './fixtures/top4-8players.json';
import { parseImportFile } from './importFile';

const ALICE = { id: uuid(101), name: 'Alice', createdAt: '2026-10-11T18:00:02.000Z' };

/** A second valid tournament, with no players. */
function otherTournament() {
  const result = createTournament(
    { ...CREATED_PAYLOAD, name: 'Saturday Modern' },
    { now: () => '2026-10-12T10:00:00.000Z', newId: () => uuid(9000) },
  );
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value.doc;
}

function dataset(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'modotorneo-dataset',
    schemaVersion: 1,
    exportedAt: '2026-10-11T20:00:00.000Z',
    players: [ALICE],
    tournaments: [structuredClone(fixture), otherTournament()],
    ...overrides,
  };
}

function expectError(json: unknown, code: string) {
  const result = parseImportFile(json);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
  return result.ok ? null : result.error;
}

describe('parseImportFile', () => {
  it('detects a plain tournament document', () => {
    const result = parseImportFile(structuredClone(fixture));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('tournament');
      expect(result.value.players).toEqual([]);
      expect(result.value.tournaments).toHaveLength(1);
      expect(result.value.tournaments[0].doc).toEqual(fixture);
      expect(result.value.tournaments[0].state.status).toBe('finished');
    }
  });

  it('parses a dataset with its players and replayed tournaments', () => {
    const result = parseImportFile(dataset());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('dataset');
      expect(result.value.players).toEqual([ALICE]);
      expect(result.value.tournaments.map((t) => t.doc.id)).toEqual([TOURNAMENT_ID, uuid(9000)]);
      expect(result.value.tournaments.map((t) => t.state.name)).toEqual([
        'Friday Night Magic',
        'Saturday Modern',
      ]);
    }
  });

  it('returns UNSUPPORTED_SCHEMA_VERSION for a dataset with schemaVersion 2', () => {
    expectError(dataset({ schemaVersion: 2 }), 'UNSUPPORTED_SCHEMA_VERSION');
  });

  it('returns INVALID_SCHEMA for a dataset with a non-integer schemaVersion', () => {
    expectError(dataset({ schemaVersion: '1' }), 'INVALID_SCHEMA');
    expectError(dataset({ schemaVersion: 1.5 }), 'INVALID_SCHEMA');
    expectError(dataset({ schemaVersion: undefined }), 'INVALID_SCHEMA');
  });

  it('returns INVALID_SCHEMA for duplicate player ids', () => {
    expectError(dataset({ players: [ALICE, { ...ALICE, name: 'Alicia' }] }), 'INVALID_SCHEMA');
  });

  it('returns INVALID_SCHEMA for two tournaments sharing an id', () => {
    const error = expectError(
      dataset({ tournaments: [structuredClone(fixture), structuredClone(fixture)] }),
      'INVALID_SCHEMA',
    );
    expect(error?.message).toContain(`Tournament 1 (${TOURNAMENT_ID})`);
  });

  it('rejects the whole dataset when one tournament is invalid, naming its index and id', () => {
    const broken = structuredClone(fixture);
    broken.events[3].seq = 99;
    const error = expectError(dataset({ tournaments: [otherTournament(), broken] }), 'SEQ_GAP');
    expect(error?.message).toContain(`Tournament 1 (${TOURNAMENT_ID})`);
  });

  it('keeps UNSUPPORTED_SCHEMA_VERSION for a tournament inside a dataset', () => {
    const newer = { ...structuredClone(fixture), schemaVersion: 2 };
    const error = expectError(dataset({ tournaments: [newer] }), 'UNSUPPORTED_SCHEMA_VERSION');
    expect(error?.message).toContain(`Tournament 0 (${TOURNAMENT_ID})`);
  });

  it('parses anything without the dataset kind as a tournament document', () => {
    expectError({ ...dataset(), kind: 'something-else' }, 'INVALID_SCHEMA');
    expectError([], 'INVALID_SCHEMA');
    expectError(null, 'INVALID_SCHEMA');
  });
});
