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

  it('navigates to /#/players with the Players link and keeps it active on a profile', async () => {
    renderAt('#/');
    await screen.findByRole('heading', { level: 1 });
    expect(nav().getByRole('link', { name: 'Players' })).toHaveAttribute('href', '#/players');

    fireEvent.click(nav().getByRole('link', { name: 'Players' }));
    expect(await screen.findByRole('heading', { name: 'Players', level: 1 })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/players');
    expect(nav().getByRole('link', { name: 'Players' })).toHaveAttribute('data-active', 'true');
    expect(nav().getByRole('link', { name: 'Tournaments' })).not.toHaveAttribute('data-active');
  });

  it('marks Players active on /#/players/:id', async () => {
    renderAt('#/players/00000000-0000-4000-8000-000000000001');
    expect(await screen.findByText('Player not found')).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Players' })).toHaveAttribute('data-active', 'true');
    expect(nav().getByRole('link', { name: 'Tournaments' })).not.toHaveAttribute('data-active');
  });

  it('navigates to /#/metagame with the Metagame link and keeps it active with a query', async () => {
    renderAt('#/');
    await screen.findByRole('heading', { level: 1 });
    expect(nav().getByRole('link', { name: 'Metagame' })).toHaveAttribute('href', '#/metagame');

    fireEvent.click(nav().getByRole('link', { name: 'Metagame' }));
    // The metagame chunk pulls in recharts: its first import is slow under a full test run.
    expect(
      await screen.findByRole('heading', { name: 'Metagame', level: 1 }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('#/metagame');
    expect(nav().getByRole('link', { name: 'Metagame' })).toHaveAttribute('data-active', 'true');
    expect(nav().getByRole('link', { name: 'Tournaments' })).not.toHaveAttribute('data-active');
  });

  it('marks Metagame active on /#/metagame with a query', async () => {
    renderAt('#/metagame?format=modern');
    // The metagame chunk pulls in recharts: its first import is slow under a full test run.
    expect(
      await screen.findByRole('heading', { name: 'Metagame', level: 1 }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Metagame' })).toHaveAttribute('data-active', 'true');
    expect(nav().getByRole('link', { name: 'Tournaments' })).not.toHaveAttribute('data-active');
  });

  it('renders the not-found page inside the shell', async () => {
    renderAt('#/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Data' })).toBeInTheDocument();
  });
});
