import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { uuid } from '../../domain/fixtures/builders';
import { PlayerName } from './PlayerName';

function renderName(guest: boolean) {
  render(
    <MantineProvider env="test">
      <MemoryRouter>
        <PlayerName playerId={uuid(1)} name="Alice" guest={guest} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('PlayerName', () => {
  it("links a registry player's name to the profile", () => {
    renderName(false);
    expect(screen.getByRole('link', { name: 'Alice' })).toHaveAttribute(
      'href',
      `/players/${uuid(1)}`,
    );
  });

  it("shows a guest's name as plain text", () => {
    renderName(true);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
