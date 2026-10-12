import { createHashRouter } from 'react-router';
import { DataPage } from './pages/DataPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

export const router = createHashRouter([
  { path: '/', element: <HomePage /> },
  { path: '/data', element: <DataPage /> },
  { path: '*', element: <NotFoundPage /> },
]);
