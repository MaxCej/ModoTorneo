import { describe, expect, it } from 'vitest';
import { executeAll, type Deps } from './commands';
import {
  CREATED_PAYLOAD,
  PLAYERS,
  TOURNAMENT_ID,
  WIN_A,
  matchId,
  pairing,
  registeredLog,
  swissHistory,
  uuid,
  type LogBuilder,
} from './fixtures/builders';
import type { PairingDeps } from './pairing';
import { redoPairingCommands } from './redoPairings';
import { reduce } from './reduce';
import { recommendedSwissRounds } from './swissRounds';
import type { TournamentDocument } from './schemas/document';

const [P1, P2, P3, P4, P5] = PLAYERS;

/** Deterministic deps: ids `uuid(60_001)`…, a fixed clock and `random` always 0. */
function fixedDeps(): Deps & PairingDeps {
  let n = 60_000;
  return { now: () => '2026-10-11T20:00:00.000Z', newId: () => uuid(++n), random: () => 0 };
}

const docOf = (log: LogBuilder): TournamentDocument => ({
  schemaVersion: 1,
  id: TOURNAMENT_ID,
  events: log.events,
});

/** Round 1 closed (P1 beat P2, P3 beat P4), then round 2 paired as matches 3 and 4. */
function round2Open() {
  return swissHistory(PLAYERS.slice(0, 4), [
    [
      [P1, P2],
      [P3, P4],
    ],
  ]).add('RoundPaired', {
    round: 2,
    stage: 'swiss',
    pairings: [pairing(3, 1, P1, P3), pairing(4, 2, P2, P4)],
  });
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Runs the redo commands and returns the final state. */
function redo(log: LogBuilder) {
  const doc = docOf(log);
  const deps = fixedDeps();
  const plan = unwrap(redoPairingCommands(doc, deps));
  const { state, doc: next } = unwrap(executeAll(doc, plan.commands, deps));
  return { plan, state, doc: next };
}

describe('redoPairingCommands', () => {
  it('without results, rolls back to before the round and pairs the same round again', () => {
    const log = round2Open(); // seq 10 is RoundPaired round 2
    const { plan, state } = redo(log);

    expect(plan.commands.map((c) => c.type)).toEqual(['RolledBack', 'RoundPaired']);
    expect(plan.commands[0]).toEqual({ type: 'RolledBack', payload: { toSeq: 9 } });
    expect(plan.commands[1]).toMatchObject({ payload: { round: 2, stage: 'swiss' } });
    expect(plan).toMatchObject({ round: 2, voidedResults: 0, voidedSwaps: 0, carried: 0 });
    expect(state.rounds.map((r) => [r.number, r.closed])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(state.voidedSeqs).toEqual([10]);
  });

  it('voids and counts the round’s results and swaps', () => {
    const log = round2Open()
      .add('PlayersSwapped', { round: 2, playerA: P3, playerB: P2 })
      .add('ResultReported', { matchId: matchId(3), result: WIN_A })
      .add('ResultReported', { matchId: matchId(4), result: WIN_A });
    const { plan, state } = redo(log);

    expect(plan).toMatchObject({ voidedResults: 2, voidedSwaps: 1, carried: 0 });
    expect(state.voidedSeqs).toEqual([10, 11, 12, 13]);
    expect(state.rounds[1].matches.every((m) => m.result === null)).toBe(true);
  });

  it('carries a player registered during the round and pairs them', () => {
    const log = round2Open()
      .add('ResultReported', { matchId: matchId(3), result: WIN_A })
      .add('PlayerRegistered', { playerId: P5, playerName: 'Late' });
    const { plan, state } = redo(log);

    expect(plan.commands.map((c) => c.type)).toEqual([
      'RolledBack',
      'PlayerRegistered',
      'RoundPaired',
    ]);
    expect(plan.commands[1]).toEqual({
      type: 'PlayerRegistered',
      payload: { playerId: P5, playerName: 'Late' },
    });
    expect(plan).toMatchObject({ carried: 1, voidedResults: 1 });
    expect(state.players[P5]).toMatchObject({ registeredAtRound: 1, dropped: false });
    const paired = state.rounds[1].matches.flatMap((m) => [m.playerA, m.playerB]);
    expect(paired).toContain(P5);
  });

  it('carries a deck set during the round as SetDeck', () => {
    const deck = {
      archetype: 'Burn',
      main: [{ quantity: 4, name: 'Lightning Bolt' }],
      sideboard: [],
    };
    const log = round2Open()
      .add('ResultReported', { matchId: matchId(3), result: WIN_A })
      .add('DeckSet', { playerId: P2, ...deck });
    const { plan, state } = redo(log);

    expect(plan.commands.map((c) => c.type)).toEqual(['RolledBack', 'SetDeck', 'RoundPaired']);
    expect(plan).toMatchObject({ carried: 1, voidedResults: 1 });
    expect(state.players[P2].deck).toEqual(deck);
  });

  it('carries a player dropped during the round and does not pair them', () => {
    const log = round2Open().add('PlayerDropped', { playerId: P4 });
    const { plan, state } = redo(log);

    expect(plan.carried).toBe(1);
    expect(state.players[P4].dropped).toBe(true);
    const paired = state.rounds[1].matches.flatMap((m) => [m.playerA, m.playerB]);
    expect(paired).not.toContain(P4);
    expect(paired).toContain(null); // 3 active players: one bye
  });

  it('carries a details change made during the round', () => {
    const log = round2Open().add('TournamentDetailsChanged', { name: 'Renamed' });
    const { plan, state } = redo(log);

    expect(plan.commands[1]).toEqual({
      type: 'TournamentDetailsChanged',
      payload: { name: 'Renamed' },
    });
    expect(state.name).toBe('Renamed');
  });

  it('leaves the events of earlier rounds untouched', () => {
    const log = round2Open().add('ResultReported', { matchId: matchId(3), result: WIN_A });
    const before = reduce(log.events, TOURNAMENT_ID);
    const { state, doc } = redo(log);

    expect(state.rounds[0]).toEqual(before.rounds[0]);
    expect(doc.events.slice(0, log.events.length)).toEqual(log.events);
    expect(state.voidedSeqs.every((seq) => seq >= 10)).toBe(true);
  });

  it('returns NO_OPEN_ROUND with no round, a closed round or an open top cut round', () => {
    const noRound = registeredLog(4);
    const closed = swissHistory(PLAYERS.slice(0, 4), [
      [
        [P1, P2],
        [P3, P4],
      ],
    ]);
    const topCut = swissHistory(
      PLAYERS.slice(0, 4),
      [
        [
          [P1, P2],
          [P3, P4],
        ],
      ],
      { ...CREATED_PAYLOAD, swissRounds: 1 },
    )
      .add('TopCutStarted', { size: 4 })
      .add('RoundPaired', {
        round: 2,
        stage: 'topCut',
        pairings: [pairing(3, 1, P1, P4), pairing(4, 2, P3, P2)],
      });

    for (const log of [noRound, closed, topCut]) {
      expect(redoPairingCommands(docOf(log), fixedDeps())).toMatchObject({
        ok: false,
        error: { code: 'NO_OPEN_ROUND' },
      });
    }
  });

  it('redoes round 1 through setup and back to running', () => {
    const log = registeredLog(4, { ...CREATED_PAYLOAD, swissRounds: null })
      .add('RoundPaired', {
        round: 1,
        stage: 'swiss',
        pairings: [pairing(1, 1, P1, P2), pairing(2, 2, P3, P4)],
      })
      .add('PlayerRegistered', { playerId: P5, playerName: 'Late' });
    const doc = docOf(log);
    const deps = fixedDeps();
    const plan = unwrap(redoPairingCommands(doc, deps));

    // After the rollback (before round 1) the tournament is in setup again.
    const rolledBack = unwrap(executeAll(doc, [plan.commands[0]], deps));
    expect(rolledBack.state).toMatchObject({ status: 'setup', swissRounds: null, rounds: [] });

    const { state } = unwrap(executeAll(doc, plan.commands, deps));
    expect(state.status).toBe('running');
    expect(state.rounds.map((r) => r.number)).toEqual([1]);
    expect(state.players[P5].registeredAtRound).toBe(0);
    // Auto rounds were fixed from 4 players, and are fixed again from the 5 active players.
    expect(reduce(log.events, TOURNAMENT_ID).swissRounds).toBe(recommendedSwissRounds(4));
    expect(state.swissRounds).toBe(recommendedSwissRounds(5));
  });

  it('returns the pairing error and appends nothing when pairing fails', () => {
    // Only one active player is left after the carried drops.
    const log = registeredLog(2)
      .add('RoundPaired', { round: 1, stage: 'swiss', pairings: [pairing(1, 1, P1, P2)] })
      .add('PlayerDropped', { playerId: P2 });
    const doc = docOf(log);
    const before = structuredClone(doc);

    const result = redoPairingCommands(doc, fixedDeps());

    expect(result.ok).toBe(false);
    expect(doc).toEqual(before);
  });
});
