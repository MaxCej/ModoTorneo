import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import { RouterProvider, createMemoryRouter, useParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieBackend, type StorageBackend } from '../storage';
import { NewTournamentPage } from './NewTournamentPage';

const mocks = vi.hoisted(() => ({ backend: null as StorageBackend | null }));

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>();
  return { ...actual, getStorage: () => mocks.backend! };
});

let dbCount = 0;

beforeEach(() => {
  dbCount += 1;
  mocks.backend = new DexieBackend({ dbName: `test-new-tournament-${dbCount}` });
});

function OpenedTournament() {
  return <p>Opened {useParams().id}</p>;
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Home</p> },
      { path: '/tournaments/new', element: <NewTournamentPage /> },
      { path: '/tournaments/:id', element: <OpenedTournament /> },
    ],
    { initialEntries: ['/tournaments/new'] },
  );
  render(
    // env="test" turns off transitions and portals, so dropdowns render at once.
    <MantineProvider env="test">
      <RouterProvider router={router} />
    </MantineProvider>,
  );
  return router;
}

function typeName(name: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: name } });
}

function pickFormat(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Format' }));
  fireEvent.click(screen.getByRole('option', { name: label }));
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create' }));

async function storedCreatedPayload() {
  const list = await mocks.backend!.listTournaments();
  if (!list.ok || list.value.length !== 1) {
    throw new Error(`expected one tournament, got ${JSON.stringify(list)}`);
  }
  const loaded = await mocks.backend!.loadTournament(list.value[0].id);
  if (!loaded.ok) {
    throw new Error('expected ok');
  }
  return { id: list.value[0].id, event: loaded.value.doc.events[0] };
}

describe('NewTournamentPage', () => {
  it('blocks submit with an empty name', async () => {
    renderPage();
    pickFormat('Modern');
    submit();

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(await mocks.backend!.listTournaments()).toEqual({ ok: true, value: [] });
  });

  it('blocks submit with a whitespace-only name', async () => {
    renderPage();
    typeName('   ');
    pickFormat('Modern');
    submit();

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
  });

  it('blocks submit with no format', async () => {
    renderPage();
    typeName('FNM');
    submit();

    expect(await screen.findByText('Format is required')).toBeInTheDocument();
    expect(await mocks.backend!.listTournaments()).toEqual({ ok: true, value: [] });
  });

  it('defaults the date to today in local time', () => {
    renderPage();
    expect(screen.getByText(dayjs().format('MMMM D, YYYY'))).toBeInTheDocument();
  });

  it('saves swissRounds null with "Auto" and opens the tournament page', async () => {
    const router = renderPage();
    typeName('  Friday Night Magic ');
    fireEvent.change(screen.getByRole('textbox', { name: 'Location' }), {
      target: { value: 'Local store' },
    });
    pickFormat('Modern');
    submit();

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/tournaments/new'));
    const { id, event } = await storedCreatedPayload();
    expect(router.state.location.pathname).toBe(`/tournaments/${id}`);
    expect(screen.getByText(`Opened ${id}`)).toBeInTheDocument();
    expect(event).toMatchObject({
      type: 'TournamentCreated',
      payload: {
        name: 'Friday Night Magic',
        date: dayjs().format('YYYY-MM-DD'),
        location: 'Local store',
        format: 'modern',
        swissRounds: null,
      },
    });
  });

  it('saves the number with "Custom"', async () => {
    const router = renderPage();
    typeName('FNM');
    pickFormat('Legacy');
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    const rounds = screen.getByRole('textbox', { name: 'Number of swiss rounds' });
    expect(rounds).toHaveValue('3');
    fireEvent.change(rounds, { target: { value: '5' } });
    submit();

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/tournaments/new'));
    const { event } = await storedCreatedPayload();
    expect(event.payload).toMatchObject({ format: 'legacy', swissRounds: 5 });
  });

  it('blocks a custom round count outside 1..20', async () => {
    renderPage();
    typeName('FNM');
    pickFormat('Modern');
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Number of swiss rounds' }), {
      target: { value: '' },
    });
    submit();

    expect(await screen.findByText('Enter a whole number from 1 to 20')).toBeInTheDocument();
    expect(await mocks.backend!.listTournaments()).toEqual({ ok: true, value: [] });
  });

  it('shows a storage error and keeps the form filled', async () => {
    mocks.backend!.saveTournament = async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'blocked' },
    });
    const router = renderPage();
    typeName('FNM');
    pickFormat('Modern');
    submit();

    expect(
      await screen.findByText('Could not create the tournament (UNAVAILABLE): blocked'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('FNM');
    expect(router.state.location.pathname).toBe('/tournaments/new');
  });

  it('goes back to the list with Cancel', async () => {
    const router = renderPage();
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
