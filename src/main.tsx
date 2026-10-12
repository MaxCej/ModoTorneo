import '@mantine/core/styles.css';
import './i18n';

import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { requestPersistence } from './storage';

// Not awaited: the app starts at once. The Data page shows the resulting status.
void requestPersistence();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>,
);
