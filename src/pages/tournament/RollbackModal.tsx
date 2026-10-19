import { Alert, Button, Group, List, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  rollbackPreview,
  type TournamentDocument,
  type TournamentEventType,
  type TournamentState,
} from '../../domain';

type Props = {
  doc: TournamentDocument;
  toSeq: number;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Confirms a rollback to `#toSeq`: what it undoes, and the status and round after it. */
export function RollbackModal({ doc, toSeq, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const preview = rollbackPreview(doc.events, toSeq, doc.id);

  return (
    <Modal opened onClose={onCancel} title={t('tournament.history.modal.title', { seq: toSeq })}>
      <Stack>
        {preview.ok ? (
          <>
            <Text>
              {t('tournament.history.modal.undoes', { count: preview.value.undone.length })}
            </Text>
            <List size="sm">
              {countsByType(preview.value.undone).map(([type, count]) => (
                <List.Item key={type}>
                  {t(`tournament.history.counts.${type}`, { count })}
                </List.Item>
              ))}
            </List>
            <Text>{afterText(preview.value.after, t)}</Text>
            <Text size="sm" c="dimmed">
              {t('tournament.history.modal.permanent')}
            </Text>
          </>
        ) : (
          <Alert color="red">
            {t('tournament.commandError', {
              code: preview.error.code,
              message: preview.error.message,
            })}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t('tournament.history.modal.cancel')}
          </Button>
          <Button color="red" onClick={onConfirm} disabled={!preview.ok}>
            {t('tournament.history.modal.confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Event counts per type, in log order of first appearance. */
function countsByType(events: { type: TournamentEventType }[]): [TournamentEventType, number][] {
  const counts = new Map<TournamentEventType, number>();
  for (const { type } of events) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts];
}

function afterText(after: TournamentState, t: ReturnType<typeof useTranslation>['t']): string {
  const status = t(`tournament.history.statuses.${after.status}`);
  const last = after.rounds.at(-1);
  if (last === undefined) {
    return t('tournament.history.modal.after', { status });
  }
  return last.closed
    ? t('tournament.history.modal.afterRound', { status, round: last.number })
    : t('tournament.history.modal.afterOpen', { status, round: last.number });
}
