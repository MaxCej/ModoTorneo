import { AppShell, Burger, Center, Group, Loader, NavLink, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router';

const NAV_ITEMS = [
  {
    to: '/',
    label: 'nav.tournaments',
    isActive: (path: string) => !path.startsWith('/data') && !path.startsWith('/settings'),
  },
  { to: '/data', label: 'nav.data', isActive: (path: string) => path.startsWith('/data') },
  {
    to: '/settings',
    label: 'nav.settings',
    isActive: (path: string) => path.startsWith('/settings'),
  },
] as const;

/** Header and navigation around every page. The navbar collapses behind a burger on small screens. */
export function AppLayout() {
  const { t } = useTranslation();
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger
            opened={opened}
            onClick={toggle}
            hiddenFrom="sm"
            size="sm"
            aria-label={t('nav.toggle')}
          />
          <Text fw={700} size="lg">
            {t('app.title')}
          </Text>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs" aria-label={t('nav.label')}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={t(item.label)}
            active={item.isActive(pathname)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Suspense
          fallback={
            <Center py="xl">
              <Loader aria-label={t('app.loading')} />
            </Center>
          }
        >
          <Outlet />
        </Suspense>
      </AppShell.Main>
    </AppShell>
  );
}
