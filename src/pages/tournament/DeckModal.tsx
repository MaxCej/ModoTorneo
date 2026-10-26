import {
  Alert,
  Autocomplete,
  Button,
  Group,
  List,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  archetypeSuggestions,
  canonicalArchetype,
  cardCount,
  formatDecklist,
  parseDecklist,
  tournamentArchetypes,
  type Command,
  type Deck,
  type DeckCard,
  type DomainError,
  type PlayerEntry,
  type Result,
  type TournamentState,
} from '../../domain';
import { getStorage, type TournamentSummary } from '../../storage';

type Props = {
  state: TournamentState;
  entry: PlayerEntry;
  onClose: () => void;
  onDispatch: (cmd: Command) => Result<TournamentState, DomainError>;
};

const EMPTY: Deck = { main: [], sideboard: [] };

/** Archetype and pasted decklist of one registered player, saved as one `SetDeck`. */
export function DeckModal({ state, entry, onClose, onDispatch }: Props) {
  const { t } = useTranslation();
  const stored = entry.deck ?? EMPTY;
  const [archetype, setArchetype] = useState(stored.archetype ?? '');
  const [text, setText] = useState(() => formatDecklist(stored));
  const [error, setError] = useState<DomainError | null>(null);
  const [summaries, setSummaries] = useState<TournamentSummary[]>([]);

  // A load failure leaves only this tournament's archetypes, with no error shown.
  useEffect(() => {
    let active = true;
    getStorage()
      .listTournaments()
      .then((result) => {
        if (active && result.ok) {
          setSummaries(result.value);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // This tournament first: its current state is newer than its stored summary.
  const suggestions = useMemo(
    () =>
      archetypeSuggestions(
        [
          { format: state.format, archetypes: tournamentArchetypes(state) },
          ...summaries.filter((summary) => summary.id !== state.id),
        ],
        state.format,
      ),
    [state, summaries],
  );
  const parsed = useMemo(() => parseDecklist(text), [text]);

  const label = canonicalArchetype(archetype, suggestions);
  const deck: Deck = {
    ...(label === '' ? {} : { archetype: label }),
    main: parsed.main,
    sideboard: parsed.sideboard,
  };
  const changed = !sameDeck(deck, stored);

  function save(next: Deck) {
    const result = onDispatch({ type: 'SetDeck', payload: { playerId: entry.playerId, ...next } });
    if (result.ok) {
      onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      title={t('tournament.deck.title', { name: entry.playerName })}
    >
      <Stack>
        <Autocomplete
          label={t('tournament.deck.archetype')}
          value={archetype}
          onChange={setArchetype}
          data={suggestions}
          maxLength={60}
        />
        <Textarea
          label={t('tournament.deck.decklist')}
          placeholder={t('tournament.deck.placeholder')}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          autosize
          minRows={10}
          maxRows={20}
        />

        {(parsed.unparsed.length > 0 || parsed.capped.length > 0) && (
          <Alert color="orange">
            {parsed.unparsed.length > 0 && (
              <>
                <Text size="sm">
                  {t('tournament.deck.unparsed', { count: parsed.unparsed.length })}
                </Text>
                <List size="sm">
                  {parsed.unparsed.map(({ line, text: lineText }) => (
                    <List.Item key={line}>
                      {t('tournament.deck.unparsedLine', { line, text: lineText })}
                    </List.Item>
                  ))}
                </List>
              </>
            )}
            {parsed.capped.map((name) => (
              <Text key={name} size="sm">
                {t('tournament.deck.capped', { name })}
              </Text>
            ))}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <CardList
            title={t('tournament.deck.main', { count: cardCount(parsed.main) })}
            cards={parsed.main}
          />
          <CardList
            title={t('tournament.deck.sideboard', { count: cardCount(parsed.sideboard) })}
            cards={parsed.sideboard}
          />
        </SimpleGrid>

        {error !== null && (
          <Alert color="red">
            {t('tournament.commandError', { code: error.code, message: error.message })}
          </Alert>
        )}

        <Group justify="flex-end">
          {entry.deck !== null && (
            <Button variant="default" color="red" onClick={() => save(EMPTY)}>
              {t('tournament.deck.clear')}
            </Button>
          )}
          <Button disabled={!changed} onClick={() => save(deck)}>
            {t('tournament.deck.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** One preview section: its heading with the card count, then one `N Name` row per card. */
function CardList({ title, cards }: { title: string; cards: DeckCard[] }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500} id={id}>
        {title}
      </Text>
      <List size="sm" listStyleType="none" aria-labelledby={id}>
        {cards.map((card) => (
          <List.Item key={card.name}>
            {t('tournament.deck.card', { quantity: card.quantity, name: card.name })}
          </List.Item>
        ))}
      </List>
    </Stack>
  );
}

function sameDeck(a: Deck, b: Deck): boolean {
  const sameCards = (x: DeckCard[], y: DeckCard[]) =>
    x.length === y.length &&
    x.every((card, i) => card.quantity === y[i].quantity && card.name === y[i].name);
  return (
    a.archetype === b.archetype && sameCards(a.main, b.main) && sameCards(a.sideboard, b.sideboard)
  );
}
