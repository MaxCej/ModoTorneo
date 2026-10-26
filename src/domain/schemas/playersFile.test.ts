import { describe, expect, it } from 'vitest';
import { parsePlayersFile } from './playersFile';

const alice = {
  id: '6f1c2b0e-8a4d-4c3e-9b1a-2d5e7f8a9b0c',
  name: 'Alice',
  createdAt: '2026-10-11T18:30:00.000Z',
};
const bob = {
  id: '7a2d3c1f-9b5e-4d4f-8c2b-3e6f8a9b0c1d',
  name: 'Bóbby',
  createdAt: '2026-10-11T18:31:00.000Z',
};
const valid = { kind: 'modotorneo-players', schemaVersion: 1, players: [alice, bob] };

describe('parsePlayersFile', () => {
  it('accepts a valid file', () => {
    expect(parsePlayersFile(valid)).toEqual({ ok: true, value: valid });
  });

  it('accepts an empty player list', () => {
    expect(parsePlayersFile({ ...valid, players: [] }).ok).toBe(true);
  });

  it('trims player names', () => {
    const parsed = parsePlayersFile({ ...valid, players: [{ ...alice, name: '  Alice ' }] });
    expect(parsed.ok && parsed.value.players[0]?.name).toBe('Alice');
  });

  it.each([
    ['a wrong kind', { ...valid, kind: 'modotorneo-dataset' }],
    ['a wrong schemaVersion', { ...valid, schemaVersion: 2 }],
    ['an invalid player', { ...valid, players: [{ ...alice, name: '' }] }],
    ['a duplicate player id', { ...valid, players: [alice, { ...bob, id: alice.id }] }],
    ['missing players', { kind: 'modotorneo-players', schemaVersion: 1 }],
    ['a non-object', 'players'],
  ])('rejects %s with INVALID_SCHEMA', (_name, json) => {
    const parsed = parsePlayersFile(json);
    expect(parsed.ok || parsed.error.code).toBe('INVALID_SCHEMA');
  });
});
