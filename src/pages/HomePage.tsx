import { Anchor, Container, Stack, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function HomePage() {
  const { t } = useTranslation();

  return (
    <Container py="xl">
      <Stack>
        <Title order={1}>{t('app.title')}</Title>
        <Anchor component={Link} to="/data">
          {t('home.dataLink')}
        </Anchor>
      </Stack>
    </Container>
  );
}
