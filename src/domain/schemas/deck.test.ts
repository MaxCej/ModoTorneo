import { describe, expect, it } from 'vitest';
import { DeckCardSchema, DeckSchema } from './deck';

const card = (quantity: number, name = 'Lightning Bolt') => ({ quantity, name });

describe('DeckSchema', () => {
  it('accepts an archetype only, a list only, both, or nothing', () => {
    for (const deck of [
      { archetype: 'Burn', main: [], sideboard: [] },
      { main: [card(4)], sideboard: [card(2, 'Smash to Smithereens')] },
      { archetype: 'Burn', main: [card(4)], sideboard: [] },
      { main: [], sideboard: [] },
    ]) {
      expect(DeckSchema.parse(deck)).toEqual(deck);
    }
  });

  it('trims the archetype and card names', () => {
    expect(
      DeckSchema.parse({ archetype: '  Burn ', main: [card(4, ' Goblin Guide ')], sideboard: [] }),
    ).toEqual({ archetype: 'Burn', main: [card(4, 'Goblin Guide')], sideboard: [] });
  });

  it('accepts a 60-character archetype and rejects 61 characters', () => {
    const deck = (archetype: string) => ({ archetype, main: [], sideboard: [] });
    expect(DeckSchema.safeParse(deck('a'.repeat(60))).success).toBe(true);
    expect(DeckSchema.safeParse(deck('a'.repeat(61))).success).toBe(false);
  });

  it('rejects a blank archetype', () => {
    expect(DeckSchema.safeParse({ archetype: '  ', main: [], sideboard: [] }).success).toBe(false);
  });

  it('accepts 250 main deck cards and 100 sideboard cards, and rejects one more', () => {
    const cards = (count: number) => Array.from({ length: count }, (_, i) => card(1, `Card ${i}`));
    expect(DeckSchema.safeParse({ main: cards(250), sideboard: cards(100) }).success).toBe(true);
    expect(DeckSchema.safeParse({ main: cards(251), sideboard: [] }).success).toBe(false);
    expect(DeckSchema.safeParse({ main: [], sideboard: cards(101) }).success).toBe(false);
  });
});

describe('DeckCardSchema', () => {
  it.each([1, 99])('accepts quantity %i', (quantity) => {
    expect(DeckCardSchema.safeParse(card(quantity)).success).toBe(true);
  });

  it.each([0, 100, 1.5])('rejects quantity %s', (quantity) => {
    expect(DeckCardSchema.safeParse(card(quantity)).success).toBe(false);
  });

  it('rejects a blank name and a name over 150 characters', () => {
    expect(DeckCardSchema.safeParse(card(1, ' ')).success).toBe(false);
    expect(DeckCardSchema.safeParse(card(1, 'a'.repeat(151))).success).toBe(false);
  });
});
