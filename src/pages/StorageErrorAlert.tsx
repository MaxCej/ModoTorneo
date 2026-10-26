import { Alert, Anchor, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { StorageError, StorageSettings } from '../storage';

/**
 * A list page's load error, worded for the active backend. `page` picks the SPEC 03 texts
 * ("home" or "data", "players" from SPEC 10 and "metagame" from SPEC 12) kept for local storage.
 */
export function StorageErrorAlert({
  error,
  settings,
  page,
}: {
  error: StorageError;
  settings: StorageSettings;
  page: 'home' | 'data' | 'players' | 'metagame';
}) {
  const { t } = useTranslation();
  if (error.code === 'UNAUTHORIZED') {
    return (
      <Alert color="red">
        <Stack gap="xs">
          <Text size="sm">{t('storage.unauthorized')}</Text>
          {/* A plain hash link: works with the hash router and on pages rendered without one. */}
          <Anchor href="#/settings" size="sm">
            {t('storage.openSettings')}
          </Anchor>
        </Stack>
      </Alert>
    );
  }
  if (error.code === 'UNAVAILABLE') {
    return (
      <Alert color="red">
        {settings.backend === 'github'
          ? t('storage.githubUnavailable', { message: error.message })
          : t(`${page}.unavailable`)}
      </Alert>
    );
  }
  return (
    <Alert color="red">
      {t(`${page}.loadFailed`, { code: error.code, message: error.message })}
    </Alert>
  );
}
