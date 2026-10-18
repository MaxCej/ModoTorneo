import { lazy } from 'react';
import { createHashRouter, type RouteObject } from 'react-router';
import { AppLayout } from './app/AppLayout';

// One chunk per page, so the main bundle stays small.
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const DataPage = lazy(() => import('./pages/DataPage').then((m) => ({ default: m.DataPage })));
const NewTournamentPage = lazy(() =>
  import('./pages/NewTournamentPage').then((m) => ({ default: m.NewTournamentPage })),
);
const TournamentPage = lazy(() =>
  import('./pages/TournamentPage').then((m) => ({ default: m.TournamentPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/tournaments/new', element: <NewTournamentPage /> },
      { path: '/tournaments/:id', element: <TournamentPage /> },
      { path: '/data', element: <DataPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createHashRouter(routes);
