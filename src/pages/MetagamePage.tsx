import { Container, Loader, Stack, Text, Title } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  defaultMetagameFormat,
  FormatSchema,
  IsoDateSchema,
  metagameReport,
  type IsoDate,
} from '../domain';
import { getStorage, readSettings, type StorageError, type TournamentSummary } from '../storage';
import { StorageErrorAlert } from './StorageErrorAlert';
import { ArchetypeTable } from './metagame/ArchetypeTable';
import { MetagameFilters, type FilterChange } from './metagame/MetagameFilters';

type Data =
  | { status: 'loading' }
  | { status: 'ready'; tournaments: TournamentSummary[] }
  | { status: 'error'; error: StorageError };

/** A query value parsed with `schema`, or null when missing or invalid. */
function queryValue<T>(
  params: URLSearchParams,
  name: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): T | null {
  const parsed = schema.safeParse(params.get(name));
  return parsed.success ? parsed.data : null;
}

/** Archetype share, win rates and matchups of one format, from summary rows only. */
export function MetagamePage() {
  const { t } = useTranslation();
  const [settings] = useState(readSettings);
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Data>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void getStorage()
      .listTournaments()
      .then((result) => {
        if (active) {
          setData(
            result.ok
              ? { status: 'ready', tournaments: result.value }
              : { status: 'error', error: result.error },
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const tournaments = useMemo(() => (data.status === 'ready' ? data.tournaments : []), [data]);
  const fallback = useMemo(() => defaultMetagameFormat(tournaments), [tournaments]);
  const format = queryValue(params, 'format', FormatSchema) ?? fallback;
  const from: IsoDate | null = queryValue(params, 'from', IsoDateSchema);
  const to: IsoDate | null = queryValue(params, 'to', IsoDateSchema);
  const report = useMemo(
    () => (format === null ? null : metagameReport(tournaments, { format, from, to })),
    [tournaments, format, from, to],
  );

  function change({ name, value }: FilterChange) {
    if (format === null) {
      return;
    }
    // The current format goes in the query too, so a later default never changes the view.
    const next = new URLSearchParams(params);
    next.set('format', format);
    if (value === null) {
      next.delete(name);
    } else {
      next.set(name, value);
    }
    setParams(next, { replace: true });
  }

  return (
    <Container size="lg" py="xl">
      <Stack>
        <Title order={1}>{t('metagame.title')}</Title>

        {data.status === 'error' && (
          <StorageErrorAlert error={data.error} settings={settings} page="metagame" />
        )}
        {data.status === 'loading' && <Loader />}
        {data.status === 'ready' && fallback === null && <Text>{t('metagame.noDecks')}</Text>}
        {data.status === 'ready' && fallback !== null && format !== null && report !== null && (
          <>
            <MetagameFilters format={format} from={from} to={to} onChange={change} />
            {report.tournaments > 0 && (
              <Text>
                {t('metagame.summary', {
                  tournaments: t('metagame.tournaments', { count: report.tournaments }),
                  players: t('metagame.players', { count: report.players }),
                })}
              </Text>
            )}
            {report.skipped > 0 && (
              <Text c="dimmed" size="sm">
                {t('metagame.skipped', { count: report.skipped })}
              </Text>
            )}
            {report.tournaments === 0 ? (
              <Text>{t('metagame.noMatch', { format: t(`formats.${format}`) })}</Text>
            ) : (
              <ArchetypeTable archetypes={report.archetypes} />
            )}
          </>
        )}
      </Stack>
    </Container>
  );
}
