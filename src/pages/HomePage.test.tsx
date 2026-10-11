import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('renders the app title', () => {
    render(
      <MantineProvider>
        <HomePage />
      </MantineProvider>,
    );

    expect(screen.getByRole('heading', { name: 'ModoTorneo' })).toBeInTheDocument();
  });
});
