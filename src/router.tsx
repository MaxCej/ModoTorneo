import { Center, Loader } from '@mantine/core';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { createHashRouter, type RouteObject } from 'react-router';
import { AppLayout } from './app/AppLayout';

// One chunk per page, so the main bundle stays small.
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const DataPage = lazy(() => import('./pages/DataPage').then((m) => ({ default: m.DataPage })));
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const NewTournamentPage = lazy(() =>
  import('./pages/NewTournamentPage').then((m) => ({ default: m.NewTournamentPage })),
);
const TournamentPage = lazy(() =>
  import('./pages/TournamentPage').then((m) => ({ default: m.TournamentPage })),
);
const PlayersPage = lazy(() =>
  import('./pages/PlayersPage').then((m) => ({ default: m.PlayersPage })),
);
const PlayerPage = lazy(() =>
  import('./pages/PlayerPage').then((m) => ({ default: m.PlayerPage })),
);
const MetagamePage = lazy(() =>
  import('./pages/MetagamePage').then((m) => ({ default: m.MetagamePage })),
);
const TimerPage = lazy(() => import('./pages/TimerPage').then((m) => ({ default: m.TimerPage })));
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

function TimerFallback() {
  const { t } = useTranslation();
  return (
    <Center py="xl">
      <Loader aria-label={t('app.loading')} />
    </Center>
  );
}

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/tournaments/new', element: <NewTournamentPage /> },
      { path: '/tournaments/:id', element: <TournamentPage /> },
      { path: '/players', element: <PlayersPage /> },
      { path: '/players/:id', element: <PlayerPage /> },
      { path: '/metagame', element: <MetagamePage /> },
      { path: '/data', element: <DataPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // The big timer (SPEC 13) has no app navigation: it is projected for players.
  {
    path: '/tournaments/:id/timer',
    element: (
      <Suspense fallback={<TimerFallback />}>
        <TimerPage />
      </Suspense>
    ),
  },
];

export const router = createHashRouter(routes);
