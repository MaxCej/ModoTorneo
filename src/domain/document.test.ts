import { describe, expect, it } from 'vitest';
import { parseTournamentDocument } from './document';
import { PLAYERS, TOURNAMENT_ID, matchId } from './fixtures/builders';
import fixture from './fixtures/top4-8players.json';
import { buildTop4Fixture } from './fixtures/top4-8players';

const [P1, , , P4, , , , P8] = PLAYERS;

/** A fresh, mutable copy of the fixture. */
function fixtureCopy() {
  return JSON.parse(JSON.stringify(fixture)) as {
    schemaVersion: unknown;
    events: Array<Record<string, unknown>>;
  };
}

function parsedFixture() {
  const result = parseTournamentDocument(fixtureCopy());
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe('parseTournamentDocument', () => {
  it('fixture JSON matches its generator (regenerate with fixtures/generate.ts)', () => {
    expect(fixture).toEqual(buildTop4Fixture());
  });

  it('parses the Top 4 fixture into a finished tournament', () => {
    const { doc, state } = parsedFixture();

    expect(doc.id).toBe(TOURNAMENT_ID);
    expect(state).toMatchObject({ id: TOURNAMENT_ID, status: 'finished', topCut: 4, lastSeq: 38 });
    expect(Object.keys(state.players)).toHaveLength(8);
    expect(state.players[P8].dropped).toBe(true);
    expect(state.rounds.map((r) => [r.number, r.stage, r.closed])).toEqual([
      [1, 'swiss', true],
      [2, 'swiss', true],
      [3, 'swiss', true],
      [4, 'topCut', true],
      [5, 'topCut', true],
    ]);
  });

  it('keeps the corrected result, voids the redone pairing and stores the bye result', () => {
    const { state } = parsedFixture();
    const matches = state.rounds.flatMap((r) => r.matches);

    expect(matches.find((m) => m.matchId === matchId(2))?.result).toMatchObject({
      winsA: 0,
      winsB: 2,
    });
    expect(state.voidedSeqs).toEqual([23]);
    expect(state.rounds[2].matches.map((m) => m.matchId)).toEqual(
      [13, 14, 15, 16].map((n) => matchId(n)),
    );
    expect(state.rounds[1].matches[3]).toMatchObject({ playerB: null, result: { winsA: 2 } });
    expect(state.rounds[4].matches[0]).toMatchObject({ playerA: P1, playerB: P4 });
  });

  it('round-trips through JSON.stringify to an equal state', () => {
    const { doc, state } = parsedFixture();

    const again = parseTournamentDocument(JSON.parse(JSON.stringify(doc)));

    expect(again).toEqual({ ok: true, value: { doc, state } });
  });

  it('returns SEQ_GAP when an event is removed', () => {
    const tampered = fixtureCopy();
    tampered.events.splice(10, 1);

    expect(parseTournamentDocument(tampered)).toMatchObject({
      ok: false,
      error: { code: 'SEQ_GAP', seq: 12 },
    });
  });

  it('returns INVALID_SCHEMA when an event is malformed', () => {
    const tampered = fixtureCopy();
    tampered.events[0].payload = {
      ...(tampered.events[0].payload as object),
      format: 'oathbreaker',
    };

    expect(parseTournamentDocument(tampered)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_SCHEMA' },
    });
  });

  it.each([2, 3, 100])('returns UNSUPPORTED_SCHEMA_VERSION for schemaVersion %j', (version) => {
    const tampered = fixtureCopy();
    tampered.schemaVersion = version;

    expect(parseTournamentDocument(tampered)).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_SCHEMA_VERSION' },
    });
  });

  it.each([0, -1, 1.5, '1', '2', null, undefined])(
    'returns INVALID_SCHEMA for schemaVersion %j',
    (version) => {
      const tampered = fixtureCopy();
      tampered.schemaVersion = version;

      expect(parseTournamentDocument(tampered)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_SCHEMA' },
      });
    },
  );

  it.each([null, 'text', 42, [], {}])('returns INVALID_SCHEMA for %j', (json) => {
    expect(parseTournamentDocument(json)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_SCHEMA' },
    });
  });

  it('returns the invariant error of a log that breaks a rule', () => {
    const tampered = fixtureCopy();
    tampered.events[1].type = 'PlayerDropped';
    tampered.events[1].payload = { playerId: PLAYERS[0] };

    expect(parseTournamentDocument(tampered)).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_PLAYER', seq: 2 },
    });
  });
});
