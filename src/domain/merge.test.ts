import { describe, expect, it } from 'vitest';
import { parseTournamentDocument } from './document';
import { PLAYERS, TOURNAMENT_ID, logBuilder, uuid } from './fixtures/builders';
import fixture from './fixtures/top4-8players.json';
import { compareLogs, playersFromDocument } from './merge';
import type { TournamentDocument } from './schemas/document';
import type { TournamentEvent } from './schemas/events';

const [P1, P2, P3] = PLAYERS;

function parsed(json: unknown) {
  const result = parseTournamentDocument(json);
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function fixtureEvents(): TournamentEvent[] {
  return parsed(structuredClone(fixture)).doc.events;
}

describe('compareLogs', () => {
  it('returns identical for equal logs, whatever the key order', () => {
    const reordered = fixtureEvents().map(({ payload, type, at, seq, id }) => ({
      payload,
      type,
      at,
      seq,
      id,
    })) as TournamentEvent[];
    expect(compareLogs(fixtureEvents(), reordered)).toBe('identical');
    expect(compareLogs([], [])).toBe('identical');
  });

  it('returns incomingAhead when local is a strict prefix of incoming', () => {
    expect(compareLogs(fixtureEvents().slice(0, 10), fixtureEvents())).toBe('incomingAhead');
  });

  it('returns localAhead when incoming is a strict prefix of local', () => {
    expect(compareLogs(fixtureEvents(), fixtureEvents().slice(0, 10))).toBe('localAhead');
  });

  it('returns diverged when an event differs', () => {
    const incoming = fixtureEvents();
    incoming[5] = { ...incoming[5], at: '2026-10-12T00:00:00.000Z' };
    expect(compareLogs(fixtureEvents(), incoming)).toBe('diverged');
  });

  it('returns diverged when the shorter log is not a prefix', () => {
    const local = fixtureEvents().slice(0, 10);
    const incoming = fixtureEvents();
    incoming[2] = { ...incoming[2], id: uuid(7777) };
    expect(compareLogs(local, incoming)).toBe('diverged');
    expect(compareLogs(incoming, local)).toBe('diverged');
  });
});

describe('playersFromDocument', () => {
  it('returns one player per registered player of the fixture, with the snapshot name', () => {
    const { doc, state } = parsed(structuredClone(fixture));
    const players = playersFromDocument(doc, state);
    expect(players).toHaveLength(8);
    expect(players[0]).toEqual({ id: P1, name: 'Alice', createdAt: '2026-10-11T18:00:02.000Z' });
    expect(players.map((p) => p.name)).toEqual([
      'Alice',
      'Bruno',
      'Carmen',
      'Diego',
      'Elena',
      'Fabio',
      'Gala',
      'Hugo',
    ]);
  });

  it('ignores voided registrations and uses the at of the effective one', () => {
    const log = logBuilder()
      .add('PlayerRegistered', { playerId: P1, playerName: 'Alice' }) // seq 2
      .add('PlayerRegistered', { playerId: P2, playerName: 'Bruno' }) // seq 3, voided
      .add('PlayerRegistered', { playerId: P3, playerName: 'Carmen' }) // seq 4, voided
      .add('RolledBack', { toSeq: 2 }) // seq 5
      .add('PlayerRegistered', { playerId: P2, playerName: 'Bruno R.' }); // seq 6
    const doc: TournamentDocument = { schemaVersion: 1, id: TOURNAMENT_ID, events: log.events };
    const { state } = parsed(doc);

    expect(playersFromDocument(doc, state)).toEqual([
      { id: P1, name: 'Alice', createdAt: log.events[1].at },
      { id: P2, name: 'Bruno R.', createdAt: log.events[5].at },
    ]);
  });

  it('returns no entry for guests', () => {
    const log = logBuilder()
      .add('PlayerRegistered', { playerId: P1, playerName: 'Alice' })
      .add('PlayerRegistered', { playerId: P2, playerName: 'Bruno', guest: false })
      .add('PlayerRegistered', { playerId: P3, playerName: 'Guest', guest: true });
    const doc: TournamentDocument = { schemaVersion: 1, id: TOURNAMENT_ID, events: log.events };
    const { state } = parsed(doc);

    expect(playersFromDocument(doc, state).map((p) => p.id)).toEqual([P1, P2]);
  });
});
