import { describe, expect, it } from 'vitest';
import {
  archetypeSuggestions,
  canonicalArchetype,
  cardCount,
  formatDecklist,
  parseDecklist,
  tournamentArchetypes,
} from './decklist';
import { PLAYERS, TOURNAMENT_ID, registeredLog } from './fixtures/builders';
import { reduce } from './reduce';

const [P1, P2, P3] = PLAYERS;

const card = (quantity: number, name: string) => ({ quantity, name });

describe('parseDecklist', () => {
  it('reads a Moxfield export, dropping set codes, collector numbers and foil markers', () => {
    const text = [
      '4 Lightning Bolt (2X2) 117',
      '4 Ragavan, Nimble Pilferer (MH2) 138 *F*',
      '2 Fable of the Mirror-Breaker (NEO) 141 *E*',
      '18 Mountain (UNF) 238',
      '',
      'SIDEBOARD:',
      '2 Blood Moon [MM3] 87',
      '1 Smash to Smithereens',
    ].join('\n');

    expect(parseDecklist(text)).toEqual({
      main: [
        card(4, 'Lightning Bolt'),
        card(4, 'Ragavan, Nimble Pilferer'),
        card(2, 'Fable of the Mirror-Breaker'),
        card(18, 'Mountain'),
      ],
      sideboard: [card(2, 'Blood Moon'), card(1, 'Smash to Smithereens')],
      unparsed: [],
      capped: [],
    });
  });

  it('reads an MTG Arena export with Deck and Sideboard headers', () => {
    const text =
      'Deck\r\n4 Thoughtseize (2XM) 107\r\n20 Swamp\r\n\r\nSideboard\r\n3 Duress (M20) 96';

    expect(parseDecklist(text)).toMatchObject({
      main: [card(4, 'Thoughtseize'), card(20, 'Swamp')],
      sideboard: [card(3, 'Duress')],
      unparsed: [],
    });
  });

  it('starts the sideboard at the first blank line after a main deck card', () => {
    const text = '\n\n4 Opt\n\n2 Negate\n\n1 Dispel';
    expect(parseDecklist(text)).toMatchObject({
      main: [card(4, 'Opt')],
      sideboard: [card(2, 'Negate'), card(1, 'Dispel')],
    });
  });

  it('reads Nx quantities and SB: prefixes, and switches back on a Main header', () => {
    const text = [
      '4x Lightning Bolt',
      'SB: 2 Pyroblast',
      'Sideboard',
      '1X Abrade',
      'Mainboard:',
      '2 Opt',
    ].join('\n');

    expect(parseDecklist(text)).toMatchObject({
      main: [card(4, 'Lightning Bolt'), card(2, 'Opt')],
      sideboard: [card(2, 'Pyroblast'), card(1, 'Abrade')],
      unparsed: [],
    });
  });

  it('accepts SB as a header with or without a colon', () => {
    expect(parseDecklist('1 Opt\nSB:\n1 Negate').sideboard).toEqual([card(1, 'Negate')]);
    expect(parseDecklist('1 Opt\nsb\n1 Negate').sideboard).toEqual([card(1, 'Negate')]);
  });

  it('collapses inner spaces in names', () => {
    expect(parseDecklist('2   Lightning    Bolt  ').main).toEqual([card(2, 'Lightning Bolt')]);
  });

  it('merges duplicate names in a section, keeping the first spelling', () => {
    const text = '2 Lightning Bolt\n1 Opt\n2 lightning bolt (2X2) 117\nSideboard\n1 LIGHTNING BOLT';

    expect(parseDecklist(text)).toMatchObject({
      main: [card(4, 'Lightning Bolt'), card(1, 'Opt')],
      sideboard: [card(1, 'LIGHTNING BOLT')],
    });
  });

  it('caps a merged quantity at 99 and reports it once', () => {
    const result = parseDecklist('60 Relentless Rats\n30 relentless rats\n20 Relentless Rats');

    expect(result.main).toEqual([card(99, 'Relentless Rats')]);
    expect(result.capped).toEqual(['Relentless Rats']);
  });

  it('returns other lines with their 1-based line numbers', () => {
    const text = [
      'About',
      'Name Mono Red',
      '4 Lightning Bolt',
      '0 Opt',
      '100 Mountain',
      'Lightning Bolt',
      `1 ${'a'.repeat(151)}`,
    ].join('\n');

    expect(parseDecklist(text)).toMatchObject({
      main: [card(4, 'Lightning Bolt')],
      unparsed: [
        { line: 1, text: 'About' },
        { line: 2, text: 'Name Mono Red' },
        { line: 4, text: '0 Opt' },
        { line: 5, text: '100 Mountain' },
        { line: 6, text: 'Lightning Bolt' },
        { line: 7, text: `1 ${'a'.repeat(151)}` },
      ],
    });
  });

  it('reports lines past 250 distinct main deck cards and 100 sideboard cards as unparsed', () => {
    const main = Array.from({ length: 251 }, (_, i) => `1 Main ${i}`);
    const sideboard = Array.from({ length: 101 }, (_, i) => `1 Side ${i}`);
    const text = [...main, '1 Main 0', 'Sideboard', ...sideboard].join('\n');

    const result = parseDecklist(text);

    expect(result.main).toHaveLength(250);
    expect(result.main[0]).toEqual(card(2, 'Main 0'));
    expect(result.sideboard).toHaveLength(100);
    expect(result.unparsed).toEqual([
      { line: 251, text: '1 Main 250' },
      { line: 354, text: '1 Side 100' },
    ]);
  });

  it('returns empty lists for empty text', () => {
    expect(parseDecklist('')).toEqual({ main: [], sideboard: [], unparsed: [], capped: [] });
  });
});

describe('formatDecklist', () => {
  const deck = {
    main: [card(4, 'Lightning Bolt'), card(20, 'Mountain')],
    sideboard: [card(2, 'Blood Moon')],
  };

  it('writes the main deck, a blank line, Sideboard and the sideboard', () => {
    expect(formatDecklist(deck)).toBe('4 Lightning Bolt\n20 Mountain\n\nSideboard\n2 Blood Moon');
  });

  it('omits the sideboard when it is empty', () => {
    expect(formatDecklist({ ...deck, sideboard: [] })).toBe('4 Lightning Bolt\n20 Mountain');
  });

  it.each([
    ['both sections', deck],
    ['main deck only', { ...deck, sideboard: [] }],
    ['sideboard only', { ...deck, main: [] }],
    ['nothing', { main: [], sideboard: [] }],
  ])('round-trips through parseDecklist (%s)', (_, lists) => {
    expect(parseDecklist(formatDecklist(lists))).toEqual({ ...lists, unparsed: [], capped: [] });
  });
});

describe('cardCount', () => {
  it('sums quantities', () => {
    expect(cardCount([card(4, 'Opt'), card(20, 'Island')])).toBe(24);
    expect(cardCount([])).toBe(0);
  });
});

describe('archetypeSuggestions', () => {
  const tournaments = [
    { format: 'modern' as const, archetypes: ['izzet prowess', 'Burn'] },
    { format: 'legacy' as const, archetypes: ['Doomsday'] },
    { format: 'modern' as const, archetypes: ['Izzet Prowess', 'Amulet Titan', 'burn'] },
  ];

  it('keeps the same format, dedupes case-insensitively with the first spelling, sorts by name', () => {
    expect(archetypeSuggestions(tournaments, 'modern')).toEqual([
      'Amulet Titan',
      'Burn',
      'izzet prowess',
    ]);
  });

  it('returns nothing for a format without tournaments', () => {
    expect(archetypeSuggestions(tournaments, 'pauper')).toEqual([]);
  });
});

describe('canonicalArchetype', () => {
  it("reuses the suggestion's spelling for a case-insensitive match", () => {
    expect(canonicalArchetype('  izzet PROWESS ', ['Burn', 'Izzet Prowess'])).toBe('Izzet Prowess');
  });

  it('returns the trimmed label without a match', () => {
    expect(canonicalArchetype(' Living End ', ['Burn'])).toBe('Living End');
  });
});

describe('tournamentArchetypes', () => {
  it('lists distinct archetypes of every player, guests included, in name order', () => {
    const log = registeredLog(3)
      .add('PlayerRegistered', { playerId: PLAYERS[3], playerName: 'Guest', guest: true })
      .add('DeckSet', { playerId: P1, archetype: 'Burn', main: [], sideboard: [] })
      .add('DeckSet', { playerId: P2, archetype: 'burn', main: [], sideboard: [] })
      .add('DeckSet', { playerId: P3, main: [card(1, 'Opt')], sideboard: [] })
      .add('DeckSet', { playerId: PLAYERS[3], archetype: 'Amulet Titan', main: [], sideboard: [] });

    expect(tournamentArchetypes(reduce(log.events, TOURNAMENT_ID))).toEqual([
      'Amulet Titan',
      'Burn',
    ]);
  });
});
