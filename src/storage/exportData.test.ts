import { describe, expect, it } from 'vitest';
import { parseImportFile, type TournamentDocument } from '../domain';
import { TOURNAMENT_ID, uuid } from '../domain/fixtures/builders';
import fixture from '../domain/fixtures/top4-8players.json';
import { DexieBackend } from './dexieBackend';
import { buildDataset, datasetFileName, tournamentFileName } from './exportData';

const NOW = '2026-10-11T20:00:00.000Z';

let dbCount = 0;

function freshBackend() {
  dbCount += 1;
  return new DexieBackend({ dbName: `test-export-data-${dbCount}`, now: () => NOW });
}

describe('tournamentFileName', () => {
  it('turns accents and symbols into dashes', () => {
    expect(tournamentFileName('Copa Ñandú #3!', '2026-10-11')).toBe(
      'modotorneo-copa-and-3-2026-10-11.json',
    );
  });

  it('lower-cases and collapses runs of other characters', () => {
    expect(tournamentFileName('  Friday   Night -- MAGIC  ', '2026-10-11')).toBe(
      'modotorneo-friday-night-magic-2026-10-11.json',
    );
  });

  it('uses "tournament" when the slug is empty', () => {
    expect(tournamentFileName('', '2026-10-11')).toBe('modotorneo-tournament-2026-10-11.json');
    expect(tournamentFileName('¡¿Ñ?!', '2026-10-11')).toBe('modotorneo-tournament-2026-10-11.json');
  });

  it('cuts the slug to 50 characters', () => {
    const name = 'a'.repeat(60);
    expect(tournamentFileName(name, '2026-10-11')).toBe(
      `modotorneo-${'a'.repeat(50)}-2026-10-11.json`,
    );
  });

  it('does not leave a trailing dash after the cut', () => {
    const name = `${'a'.repeat(49)} b`;
    expect(tournamentFileName(name, '2026-10-11')).toBe(
      `modotorneo-${'a'.repeat(49)}-2026-10-11.json`,
    );
  });
});

describe('datasetFileName', () => {
  it('uses the UTC date of exportedAt', () => {
    expect(datasetFileName('2026-10-11T23:59:59.000Z')).toBe('modotorneo-backup-2026-10-11.json');
    expect(datasetFileName('2026-10-12T00:00:00.000Z')).toBe('modotorneo-backup-2026-10-12.json');
  });
});

describe('buildDataset', () => {
  it('wraps every stored tournament and player, and parses with parseImportFile', async () => {
    const backend = freshBackend();
    await backend.saveTournament(structuredClone(fixture) as TournamentDocument, null);
    const alice = { id: uuid(101), name: 'Alice', createdAt: '2026-10-11T18:00:02.000Z' };
    await backend.savePlayer(alice);

    const built = await buildDataset(backend, () => NOW);
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.value).toEqual({
      kind: 'modotorneo-dataset',
      schemaVersion: 1,
      exportedAt: NOW,
      players: [alice],
      tournaments: [fixture],
    });

    // Round trip through the file text, as an export and a later import would.
    const parsed = parseImportFile(JSON.parse(JSON.stringify(built.value, null, 2)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.kind).toBe('dataset');
      expect(parsed.value.players).toEqual([alice]);
      expect(parsed.value.tournaments.map((t) => t.doc.id)).toEqual([TOURNAMENT_ID]);
    }
  });

  it('builds an empty dataset from an empty database', async () => {
    const built = await buildDataset(freshBackend(), () => NOW);
    expect(built.ok && built.value).toMatchObject({ players: [], tournaments: [] });
    expect(built.ok && parseImportFile(built.value).ok).toBe(true);
  });
});
