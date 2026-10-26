import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider, createHashRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../router';

function renderAt(hash: string) {
  window.location.hash = hash;
  render(
    <MantineProvider>
      <RouterProvider router={createHashRouter(routes)} />
    </MantineProvider>,
  );
}

const nav = () => within(screen.getByRole('navigation', { name: 'Main navigation' }));

describe('AppLayout', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('renders the header and both navigation links', async () => {
    renderAt('#/');
    expect(screen.getByText('ModoTorneo', { selector: 'p' })).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Tournaments' })).toHaveAttribute('href', '#/');
    expect(nav().getByRole('link', { name: 'Data' })).toHaveAttribute('href', '#/data');
    // The lazy home page renders inside the shell.
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('navigates to /#/data and back to /#/ with the links', async () => {
    renderAt('#/');
    await screen.findByRole('heading', { level: 1 });

    fireEvent.click(nav().getByRole('link', { name: 'Data' }));
    expect(await screen.findByRole('heading', { name: 'Data', level: 1 })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/data');
    expect(nav().getByRole('link', { name: 'Data' })).toHaveAttribute('data-active', 'true');

    fireEvent.click(nav().getByRole('link', { name: 'Tournaments' }));
    expect(
      await screen.findByRole('heading', { name: 'Tournaments', level: 1 }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('#/');
    expect(nav().getByRole('link', { name: 'Tournaments' })).toHaveAttribute('data-active', 'true');
  });

  it('navigates to /#/settings with the Settings link', async () => {
    renderAt('#/');
    await screen.findByRole('heading', { level: 1 });
    expect(nav().getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');

    fireEvent.click(nav().getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings');
    expect(nav().getByRole('link', { name: 'Settings' })).toHaveAttribute('data-active', 'true');
    expect(nav().getByRole('link', { name: 'Tournaments' })).not.toHaveAttribute('data-active');
  });

  it('renders the not-found page inside the shell', async () => {
    renderAt('#/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Data' })).toBeInTheDocument();
  });
});
