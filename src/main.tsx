import '@mantine/core/styles.css';
import './i18n';

import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router';

// Not awaited: the app starts at once. The Data page shows the resulting status.
// Imported on demand so Dexie, Zod and the domain stay out of the main chunk.
void import('./storage').then((storage) => storage.requestPersistence());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>,
);
