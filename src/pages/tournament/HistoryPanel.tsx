import { Badge, Button, Group, Table } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  historyOf,
  type Command,
  type DomainError,
  type History,
  type Result,
  type TournamentEvent,
  type TournamentState,
  type Uuid,
} from '../../domain';
import { useTournamentStore } from '../../store/tournamentStore';
import { useResultText } from './MatchRow';
import { RollbackModal } from './RollbackModal';

// `at` is informational only; the log is ordered by seq.
const TIME_FORMAT = new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' });

type Props = {
  onDispatch: (cmd: Command) => Result<TournamentState, DomainError>;
};

/** The full event log, newest first. Voided rows are dimmed and cannot be a rollback target. */
export function HistoryPanel({ onDispatch }: Props) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<number | null>(null);
  const doc = useTournamentStore((s) => s.doc);
  const history = useMemo(() => (doc === null ? null : historyOf(doc.events, doc.id)), [doc]);
  const label = useEventLabel();

  if (doc === null || history === null) {
    return null;
  }

  return (
    <>
      <Table.ScrollContainer minWidth={480}>
        <Table withTableBorder fz="sm" aria-label={t('tournament.history.tableLabel')}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('tournament.history.seq')}</Table.Th>
              <Table.Th>{t('tournament.history.event')}</Table.Th>
              <Table.Th>{t('tournament.history.time')}</Table.Th>
              <Table.Th>{t('tournament.history.actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {history.entries.map(({ event, voided, canRollBackTo }) => (
              <Table.Tr key={event.seq} c={voided ? 'dimmed' : undefined}>
                <Table.Td>{t('tournament.history.seqValue', { seq: event.seq })}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    {label(event, history)}
                    {voided && (
                      <Badge size="sm" variant="light" color="gray">
                        {t('tournament.history.undone')}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{TIME_FORMAT.format(new Date(event.at))}</Table.Td>
                <Table.Td>
                  {canRollBackTo && (
                    <Button
                      size="compact-sm"
                      variant="light"
                      color="red"
                      onClick={() => setTarget(event.seq)}
                    >
                      {t('tournament.history.rollBack')}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {target !== null && (
        <RollbackModal
          doc={doc}
          toSeq={target}
          onCancel={() => setTarget(null)}
          onConfirm={() => {
            onDispatch({ type: 'RolledBack', payload: { toSeq: target } });
            setTarget(null);
          }}
        />
      )}
    </>
  );
}

/** The label of one History row, with names resolved from `history`. */
function useEventLabel() {
  const { t } = useTranslation();
  const resultText = useResultText();

  return (event: TournamentEvent, history: History): string => {
    const name = (id: Uuid | null) =>
      id === null
        ? t('tournament.rounds.bye')
        : (history.playerNames[id] ?? t('tournament.history.unknownPlayer'));
    const key = `tournament.history.events.${event.type}`;

    switch (event.type) {
      case 'PlayerRegistered':
      case 'PlayerDropped':
      case 'PlayerUnregistered':
        return t(key, { name: name(event.payload.playerId) });
      case 'TournamentDetailsChanged': {
        const fields = Object.entries(event.payload)
          .filter(([, value]) => value !== undefined)
          .map(([field]) => t(`tournament.details.${field}`));
        return t(key, { fields: fields.join(', ') });
      }
      case 'RoundPaired':
      case 'RoundClosed':
        return t(key, { round: event.payload.round });
      case 'PlayersSwapped': {
        const { round, playerA, playerB } = event.payload;
        return t(key, { round, a: name(playerA), b: name(playerB) });
      }
      case 'ResultReported': {
        // The reducer accepted the log, so every reported match was paired before.
        const { round, playerA, playerB } = history.matches[event.payload.matchId]!;
        return t(key, {
          round,
          a: name(playerA),
          b: name(playerB),
          score: resultText(event.payload.result),
        });
      }
      case 'TopCutStarted':
        return t(key, { size: event.payload.size });
      case 'RolledBack':
        return t(key, { seq: event.payload.toSeq });
      case 'TournamentCreated':
      case 'TournamentFinished':
        return t(key);
    }
  };
}
