import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  function renderPage() {
    render(
      <MantineProvider>
        <HashRouter>
          <HomePage />
        </HashRouter>
      </MantineProvider>,
    );
  }

  it('renders the app title', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'ModoTorneo' })).toBeInTheDocument();
  });

  it('links to the Data page', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Data' })).toHaveAttribute('href', '#/data');
  });
});
