import { Anchor, Container, Stack, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <Container py="xl">
      <Stack>
        <Title order={1}>{t('notFound.title')}</Title>
        <Anchor component={Link} to="/">
          {t('notFound.backHome')}
        </Anchor>
      </Stack>
    </Container>
  );
}
