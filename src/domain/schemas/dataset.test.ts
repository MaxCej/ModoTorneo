import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/top4-8players.json';
import { DatasetSchema } from './dataset';

const ALICE = {
  id: '00000000-0000-4000-8000-000000000101',
  name: 'Alice',
  createdAt: '2026-10-11T18:00:02.000Z',
};

function dataset(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'modotorneo-dataset',
    schemaVersion: 1,
    exportedAt: '2026-10-11T20:00:00.000Z',
    players: [ALICE],
    tournaments: [structuredClone(fixture)],
    ...overrides,
  };
}

describe('DatasetSchema', () => {
  it('accepts a valid dataset', () => {
    expect(DatasetSchema.safeParse(dataset()).success).toBe(true);
  });

  it('accepts an empty dataset', () => {
    expect(DatasetSchema.safeParse(dataset({ players: [], tournaments: [] })).success).toBe(true);
  });

  it('rejects another kind or schemaVersion', () => {
    expect(DatasetSchema.safeParse(dataset({ kind: 'backup' })).success).toBe(false);
    expect(DatasetSchema.safeParse(dataset({ schemaVersion: 2 })).success).toBe(false);
    expect(DatasetSchema.safeParse(dataset({ schemaVersion: '1' })).success).toBe(false);
  });

  it('rejects an exportedAt with an offset', () => {
    expect(
      DatasetSchema.safeParse(dataset({ exportedAt: '2026-10-11T20:00:00+02:00' })).success,
    ).toBe(false);
  });

  it('rejects duplicate player ids', () => {
    const players = [ALICE, { ...ALICE, name: 'Alicia' }];
    expect(DatasetSchema.safeParse(dataset({ players })).success).toBe(false);
  });

  it('rejects duplicate tournament ids', () => {
    const tournaments = [structuredClone(fixture), structuredClone(fixture)];
    expect(DatasetSchema.safeParse(dataset({ tournaments })).success).toBe(false);
  });
});
