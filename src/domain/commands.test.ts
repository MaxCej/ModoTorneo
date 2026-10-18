import { describe, expect, it } from 'vitest';
import { createTournament, execute, type Deps } from './commands';
import { CREATED_PAYLOAD, PLAYERS, WIN_A, matchId, pairing, uuid } from './fixtures/builders';
import { reduce } from './reduce';
import type { TournamentDocument } from './schemas/document';

const [P1, P2, P3] = PLAYERS;

const AT = '2026-10-11T18:30:00.000Z';

/** Deterministic deps: ids `uuid(9001)`, `uuid(9002)`… and a fixed clock. */
function fixedDeps(): Deps {
  let n = 9000;
  return { now: () => AT, newId: () => uuid(++n) };
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** A tournament with P1 and P2 registered (seqs 1–3). */
function docWithTwoPlayers(deps = fixedDeps()): TournamentDocument {
  let { doc } = unwrap(createTournament(CREATED_PAYLOAD, deps));
  for (const [i, playerId] of [P1, P2].entries()) {
    ({ doc } = unwrap(
      execute(doc, { type: 'PlayerRegistered', payload: { playerId, playerName: `P${i}` } }, deps),
    ));
  }
  return doc;
}

describe('createTournament', () => {
  it('creates a document with one TournamentCreated event from the injected deps', () => {
    const { doc, state } = unwrap(createTournament(CREATED_PAYLOAD, fixedDeps()));

    expect(doc).toEqual({
      schemaVersion: 1,
      id: uuid(9001),
      events: [
        { id: uuid(9002), seq: 1, at: AT, type: 'TournamentCreated', payload: CREATED_PAYLOAD },
      ],
    });
    expect(state).toMatchObject({ id: uuid(9001), status: 'setup', lastSeq: 1 });
  });

  it('stores the schema-normalized payload', () => {
    const { doc } = unwrap(
      createTournament({ ...CREATED_PAYLOAD, name: '  Friday  ' }, fixedDeps()),
    );
    expect(doc.events[0].payload).toMatchObject({ name: 'Friday' });
  });

  it('returns INVALID_SCHEMA for an invalid payload', () => {
    const result = createTournament({ ...CREATED_PAYLOAD, name: ' ' }, fixedDeps());
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_SCHEMA', seq: 1 } });
  });

  it('uses random ids and the current time by default', () => {
    const { doc } = unwrap(createTournament(CREATED_PAYLOAD));
    expect(doc.id).not.toBe(doc.events[0].id);
    expect(Number.isNaN(Date.parse(doc.events[0].at))).toBe(false);
  });
});

describe('execute', () => {
  it('appends one deterministic event and returns the new state', () => {
    const doc = docWithTwoPlayers();
    const deps: Deps = { now: () => '2026-10-11T19:00:00.000Z', newId: () => uuid(42) };

    const {
      doc: next,
      state,
      event,
    } = unwrap(execute(doc, { type: 'PlayerDropped', payload: { playerId: P1 } }, deps));

    expect(event).toEqual({
      id: uuid(42),
      seq: 4,
      at: '2026-10-11T19:00:00.000Z',
      type: 'PlayerDropped',
      payload: { playerId: P1 },
    });
    expect(next.events).toEqual([...doc.events, event]);
    expect(next.id).toBe(doc.id);
    expect(state).toEqual(reduce(next.events, doc.id));
    expect(state.players[P1].dropped).toBe(true);
  });

  it('does not mutate the input document on success', () => {
    const doc = docWithTwoPlayers();
    const before = structuredClone(doc);

    unwrap(execute(doc, { type: 'PlayerDropped', payload: { playerId: P1 } }, fixedDeps()));

    expect(doc).toEqual(before);
  });

  it('returns the invariant error and leaves the document unchanged', () => {
    const doc = docWithTwoPlayers();
    const before = structuredClone(doc);

    const result = execute(doc, { type: 'PlayerDropped', payload: { playerId: P3 } }, fixedDeps());

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'UNKNOWN_PLAYER', seq: 4 }),
    });
    expect(doc).toEqual(before);
  });

  it('returns INVALID_SCHEMA for a payload the schema rejects', () => {
    const doc = docWithTwoPlayers();
    const before = structuredClone(doc);

    const result = execute(
      doc,
      {
        type: 'RoundPaired',
        payload: { round: 1, stage: 'swiss', pairings: [pairing(1, 0, P1, P2)] },
      },
      fixedDeps(),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_SCHEMA', seq: 4 } });
    expect(doc).toEqual(before);
  });

  it.each([
    ['an empty payload', {}],
    ['only undefined fields', { name: undefined }],
  ])('returns INVALID_SCHEMA for TournamentDetailsChanged with %s', (_, payload) => {
    const result = execute(
      docWithTwoPlayers(),
      { type: 'TournamentDetailsChanged', payload },
      fixedDeps(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_SCHEMA', seq: 4 } });
  });

  it('applies TournamentDetailsChanged with the trimmed name', () => {
    const { state, event } = unwrap(
      execute(
        docWithTwoPlayers(),
        { type: 'TournamentDetailsChanged', payload: { name: '  Saturday Modern ' } },
        fixedDeps(),
      ),
    );
    expect(event.payload).toEqual({ name: 'Saturday Modern' });
    expect(state.name).toBe('Saturday Modern');
  });

  it('rejects a second TournamentCreated', () => {
    const result = execute(
      docWithTwoPlayers(),
      { type: 'TournamentCreated', payload: CREATED_PAYLOAD },
      fixedDeps(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'DUPLICATE_CREATED' } });
  });

  it('executes a rollback and returns the replayed state', () => {
    const deps = fixedDeps();
    let doc = docWithTwoPlayers(deps);
    ({ doc } = unwrap(
      execute(
        doc,
        {
          type: 'RoundPaired',
          payload: { round: 1, stage: 'swiss', pairings: [pairing(1, 1, P1, P2)] },
        },
        deps,
      ),
    ));
    ({ doc } = unwrap(
      execute(
        doc,
        { type: 'ResultReported', payload: { matchId: matchId(1), result: WIN_A } },
        deps,
      ),
    ));

    const { doc: next, state } = unwrap(
      execute(doc, { type: 'RolledBack', payload: { toSeq: 4 } }, deps),
    );

    expect(state).toEqual(reduce(next.events, doc.id));
    expect(state).toMatchObject({ lastSeq: 6, voidedSeqs: [5] });
    expect(state.rounds[0].matches[0].result).toBeNull();
  });

  it('returns INVALID_ROLLBACK_TARGET for a voided target', () => {
    const deps = fixedDeps();
    let doc = docWithTwoPlayers(deps);
    ({ doc } = unwrap(execute(doc, { type: 'PlayerDropped', payload: { playerId: P1 } }, deps)));
    ({ doc } = unwrap(execute(doc, { type: 'RolledBack', payload: { toSeq: 3 } }, deps)));
    ({ doc } = unwrap(execute(doc, { type: 'PlayerDropped', payload: { playerId: P2 } }, deps)));

    const result = execute(doc, { type: 'RolledBack', payload: { toSeq: 4 } }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ROLLBACK_TARGET' } });
  });
});
