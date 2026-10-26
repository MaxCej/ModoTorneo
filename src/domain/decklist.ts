import type { Format } from './schemas/common';
import type { Deck, DeckCard } from './schemas/deck';
import type { TournamentState } from './state';

export type ParsedDecklist = {
  main: DeckCard[];
  sideboard: DeckCard[];
  unparsed: { line: number; text: string }[]; // 1-based line numbers
  capped: string[]; // names whose merged quantity was capped at 99
};

type Section = 'main' | 'sideboard';

const MAX_QUANTITY = 99;
const MAX_NAME_LENGTH = 150;
const MAX_DISTINCT: Record<Section, number> = { main: 250, sideboard: 100 };

const MAIN_HEADER = /^(deck|main|mainboard):?$/i;
const SIDEBOARD_HEADER = /^(sideboard|sb):?$/i;
/** `N Name`, `Nx Name` or `SB: N Name`; the name still carries any set, number and markers. */
const CARD_LINE = /^(SB:\s*)?(\d+)x?\s+(.+)$/i;
/** Trailing ` (SET) 123` or ` [SET] 123`, then foil or etched markers, as Moxfield writes them. */
const PRINTING_SUFFIX = /(?:\s+[([][^)\]]*[)\]](?:\s+\S+)?)?(?:\s+\*[FE]\*)*$/i;

/**
 * Reads a Moxfield or MTG Arena text export, or plain `N Card Name` lines.
 * Lines that are not cards or headers come back in `unparsed`.
 */
export function parseDecklist(text: string): ParsedDecklist {
  const sections: Record<Section, DeckCard[]> = { main: [], sideboard: [] };
  const indexes: Record<Section, Map<string, number>> = { main: new Map(), sideboard: new Map() };
  const unparsed: ParsedDecklist['unparsed'] = [];
  const capped: string[] = [];
  let section: Section = 'main';
  let blankSwitched = false;

  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === '') {
      // MTG Arena separates the sideboard with a blank line and no header.
      if (!blankSwitched && sections.main.length > 0) {
        section = 'sideboard';
        blankSwitched = true;
      }
      continue;
    }
    if (MAIN_HEADER.test(line)) {
      section = 'main';
      continue;
    }
    if (SIDEBOARD_HEADER.test(line)) {
      section = 'sideboard';
      continue;
    }

    const card = parseCardLine(line);
    if (card === null) {
      unparsed.push({ line: i + 1, text: raw });
      continue;
    }
    const target = card.sideboard ? 'sideboard' : section;
    const cards = sections[target];
    const key = card.name.toLowerCase();
    const index = indexes[target].get(key);
    if (index !== undefined) {
      const quantity = cards[index].quantity + card.quantity;
      if (quantity > MAX_QUANTITY && !capped.includes(cards[index].name)) {
        capped.push(cards[index].name);
      }
      cards[index] = { ...cards[index], quantity: Math.min(quantity, MAX_QUANTITY) };
    } else if (cards.length >= MAX_DISTINCT[target]) {
      unparsed.push({ line: i + 1, text: raw });
    } else {
      indexes[target].set(key, cards.length);
      cards.push({ quantity: card.quantity, name: card.name });
    }
  }

  return { main: sections.main, sideboard: sections.sideboard, unparsed, capped };
}

function parseCardLine(line: string): (DeckCard & { sideboard: boolean }) | null {
  const match = CARD_LINE.exec(line);
  if (match === null) {
    return null;
  }
  const quantity = Number(match[2]);
  const name = match[3].replace(PRINTING_SUFFIX, '').replace(/\s+/g, ' ').trim();
  if (quantity < 1 || quantity > MAX_QUANTITY || name === '' || name.length > MAX_NAME_LENGTH) {
    return null;
  }
  return { quantity, name, sideboard: match[1] !== undefined };
}

/** The stored lists as text that `parseDecklist` reads back to the same lists. */
export function formatDecklist(deck: Pick<Deck, 'main' | 'sideboard'>): string {
  const lines = (cards: readonly DeckCard[]) => cards.map((c) => `${c.quantity} ${c.name}`);
  if (deck.sideboard.length === 0) {
    return lines(deck.main).join('\n');
  }
  return [...lines(deck.main), '', 'Sideboard', ...lines(deck.sideboard)].join('\n');
}

/** Sum of quantities. */
export function cardCount(cards: readonly DeckCard[]): number {
  return cards.reduce((sum, card) => sum + card.quantity, 0);
}

const collator = new Intl.Collator('en');

/** Distinct case-insensitively; the first spelling wins. Sorted by name. */
function distinctSorted(labels: Iterable<string>): string[] {
  const byKey = new Map<string, string>();
  for (const label of labels) {
    const key = label.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, label);
    }
  }
  return [...byKey.values()].sort(collator.compare);
}

/**
 * Distinct archetypes of the tournaments with `format`, sorted by name.
 * Inputs in date-descending order, so the most recent spelling wins.
 */
export function archetypeSuggestions(
  tournaments: readonly { format: Format; archetypes: readonly string[] }[],
  format: Format,
): string[] {
  return distinctSorted(
    tournaments.filter((t) => t.format === format).flatMap((t) => t.archetypes),
  );
}

/** The suggestion with the same label (case-insensitive), else the trimmed label. */
export function canonicalArchetype(label: string, suggestions: readonly string[]): string {
  const trimmed = label.trim();
  const key = trimmed.toLowerCase();
  return suggestions.find((s) => s.toLowerCase() === key) ?? trimmed;
}

/** Distinct archetypes of every registered player (guests included), in name order. */
export function tournamentArchetypes(state: TournamentState): string[] {
  return distinctSorted(
    Object.values(state.players).flatMap((p) =>
      p.deck?.archetype === undefined ? [] : [p.deck.archetype],
    ),
  );
}
