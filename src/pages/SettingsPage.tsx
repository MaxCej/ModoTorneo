import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  readSettings,
  testConnection,
  writeSettings,
  type ConnectionCheck,
  type StorageSettings,
} from '../storage';
import { useTournamentStore } from '../store/tournamentStore';

type Fields = { owner: string; repo: string; token: string };

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'done'; fields: Fields; result: ConnectionCheck };

/** Reloads the app at the tournament list, so `getStorage()` picks the new backend. */
function reloadAtHome(): void {
  window.location.hash = '#/';
  window.location.reload();
}

/** "Storage: this browser" or "Storage: GitHub (owner/repo)". Shared with the Data page. */
export function StorageStatus({ settings }: { settings: StorageSettings }) {
  const { t } = useTranslation();
  return (
    <Text>
      {settings.backend === 'github'
        ? t('settings.statusGitHub', { owner: settings.owner, repo: settings.repo })
        : t('settings.statusLocal')}
    </Text>
  );
}

function sameFields(a: Fields, b: Fields): boolean {
  return a.owner === b.owner && a.repo === b.repo && a.token === b.token;
}

function ResultAlert({ fields, result }: { fields: Fields; result: ConnectionCheck }) {
  const { t } = useTranslation();
  if (result.ok) {
    const name = `${fields.owner}/${fields.repo}`;
    return result.private ? (
      <Alert color="green">{t('settings.result.private', { name })}</Alert>
    ) : (
      <Alert color="yellow">{t('settings.result.public', { name })}</Alert>
    );
  }
  return (
    <Alert color="red">
      {result.reason === 'unavailable'
        ? t('settings.result.unavailable', { message: result.message })
        : t(`settings.result.${result.reason}`)}
    </Alert>
  );
}

export type SettingsPageProps = {
  /** Injected in tests; the app reloads the page at `#/`. */
  reload?: () => void;
  /** Injected in tests; the app uses the global `fetch`. */
  fetchFn?: typeof fetch;
};

export function SettingsPage({ reload = reloadAtHome, fetchFn }: SettingsPageProps) {
  const { t } = useTranslation();
  // The backend is chosen once per page load, so the settings read at mount are the active ones.
  const [settings] = useState(readSettings);
  const [fields, setFields] = useState<Fields>({ owner: '', repo: '', token: '' });
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const pendingWork = useTournamentStore((s) => s.saving || s.notice?.kind === 'unsaved');

  const current: Fields = {
    owner: fields.owner.trim(),
    repo: fields.repo.trim(),
    token: fields.token.trim(),
  };
  const complete = current.owner !== '' && current.repo !== '' && current.token !== '';
  const tested = test.status === 'done' && test.result.ok && sameFields(test.fields, current);

  async function runTest() {
    const tried = current;
    setTest({ status: 'testing' });
    const result = await testConnection(tried, fetchFn);
    setTest({ status: 'done', fields: tried, result });
  }

  function connect() {
    writeSettings({ backend: 'github', ...current });
    reload();
  }

  function disconnect() {
    writeSettings({ backend: 'local' });
    reload();
  }

  const setField = (name: keyof Fields) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;
    setFields((previous) => ({ ...previous, [name]: value }));
  };

  return (
    <Container py="xl">
      <Stack>
        <Title order={1}>{t('settings.title')}</Title>
        <StorageStatus settings={settings} />

        {settings.backend === 'local' ? (
          <>
            <TextInput
              label={t('settings.owner')}
              value={fields.owner}
              onChange={setField('owner')}
            />
            <TextInput label={t('settings.repo')} value={fields.repo} onChange={setField('repo')} />
            <PasswordInput
              label={t('settings.token')}
              description={t('settings.tokenHelp')}
              value={fields.token}
              onChange={setField('token')}
              autoComplete="off"
            />
            <Text size="sm" c="dimmed">
              {t('settings.migrationHint')}
            </Text>
            <Group>
              <Button
                variant="default"
                disabled={!complete || test.status === 'testing'}
                onClick={() => void runTest()}
              >
                {t('settings.testConnection')}
              </Button>
              <Button disabled={!tested || pendingWork} onClick={connect}>
                {t('settings.connect')}
              </Button>
            </Group>
            {test.status === 'testing' && <Loader size="sm" aria-label={t('settings.testing')} />}
            {test.status === 'done' && <ResultAlert fields={test.fields} result={test.result} />}
          </>
        ) : (
          <Group>
            <Button color="red" variant="light" disabled={pendingWork} onClick={disconnect}>
              {t('settings.disconnect')}
            </Button>
          </Group>
        )}
        {pendingWork && (
          <Text size="sm" c="dimmed">
            {t('settings.pendingWork')}
          </Text>
        )}
      </Stack>
    </Container>
  );
}
