import { Card, Group, ScrollArea, Stack, Table, Text, Title } from '@mantine/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  topCutBracket,
  topCutPlacings,
  type BracketMatch,
  type BracketPlayer,
  type TournamentState,
} from '../../domain';
import { useResultText } from './MatchRow';

/** The bracket, one column per paired top cut round, and the placings. */
export function TopCutPanel({ state }: { state: TournamentState }) {
  const { t } = useTranslation();
  const bracket = useMemo(() => topCutBracket(state), [state]);
  const placings = useMemo(() => topCutPlacings(state), [state]);
  const name = (playerId: string) => state.players[playerId]?.playerName ?? playerId;
  const ordinal = (n: number) => t('tournament.topCut.ordinal', { count: n, ordinal: true });
  const place = (from: number, to: number) =>
    from === to
      ? ordinal(from)
      : t('tournament.topCut.placeRange', { from: ordinal(from), to: ordinal(to) });

  if (bracket === null) {
    return null;
  }
  return (
    <Stack>
      <Title order={3}>
        {t('tournament.topCut.heading', { size: bracket.size, bestOf: bracket.bestOf })}
      </Title>
      {bracket.rounds.length === 0 ? (
        <Text c="dimmed">{t('tournament.topCut.empty')}</Text>
      ) : (
        <ScrollArea type="auto" offsetScrollbars>
          <Group align="flex-start" wrap="nowrap" gap="md">
            {bracket.rounds.map((round) => {
              const roundName = t(`tournament.topCut.rounds.${round.name}`);
              return (
                <Stack key={round.round} gap="xs" w={240} role="group" aria-label={roundName}>
                  <Text fw={700}>{roundName}</Text>
                  {round.matches.map((match) => (
                    <BracketMatchCard key={match.table} match={match} name={name} />
                  ))}
                </Stack>
              );
            })}
          </Group>
        </ScrollArea>
      )}
      {placings.length > 0 && (
        <Table.ScrollContainer minWidth={320}>
          <Table withTableBorder fz="sm" aria-label={t('tournament.topCut.placingsLabel')}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('tournament.topCut.place')}</Table.Th>
                <Table.Th>{t('tournament.topCut.player')}</Table.Th>
                <Table.Th>{t('tournament.topCut.seed')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {placings.map((placing) => (
                <Table.Tr key={placing.playerId}>
                  <Table.Td>{place(placing.from, placing.to)}</Table.Td>
                  <Table.Td>{name(placing.playerId)}</Table.Td>
                  <Table.Td>{placing.seed}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}

type CardProps = { match: BracketMatch; name: (playerId: string) => string };

/** Both players as "(seed) name", the winner in bold, and the score. */
function BracketMatchCard({ match, name }: CardProps) {
  const { t } = useTranslation();
  const resultText = useResultText();
  const line = (player: BracketPlayer) => {
    const text = t('tournament.topCut.bracketPlayer', {
      seed: player.seed,
      name: name(player.playerId),
    });
    return match.winner === player.playerId ? (
      <Text component="strong" fw={700} size="sm">
        {text}
      </Text>
    ) : (
      <Text size="sm">{text}</Text>
    );
  };

  return (
    <Card
      withBorder
      padding="xs"
      role="group"
      aria-label={t('tournament.rounds.tableLabel', { table: match.table })}
    >
      <Stack gap={2}>
        {line(match.playerA)}
        {line(match.playerB)}
        <Text size="xs" c="dimmed">
          {match.result === null ? t('tournament.topCut.notReported') : resultText(match.result)}
        </Text>
      </Stack>
    </Card>
  );
}
