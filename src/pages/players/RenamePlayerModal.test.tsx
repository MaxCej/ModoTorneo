import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Player, type Result } from '../../domain';
import type { StorageError } from '../../storage';
import { uuid } from '../../domain/fixtures/builders';
import { RenamePlayerModal } from './RenamePlayerModal';

const ALICE: Player = { id: uuid(1), name: 'Alice', createdAt: '2026-10-11T18:00:00.000Z' };

type OnSave = (name: string) => Promise<Result<Player, StorageError>>;

function renderModal(onSave = vi.fn<OnSave>(async (name) => ok({ ...ALICE, name }))) {
  const onClose = vi.fn();
  render(
    <MantineProvider env="test">
      <RenamePlayerModal
        player={ALICE}
        otherNames={['Bruno', ' carmen ']}
        onSave={onSave}
        onClose={onClose}
      />
    </MantineProvider>,
  );
  return { onSave, onClose };
}

const input = () => screen.getByRole('textbox', { name: 'Name' });
const type = (value: string) => fireEvent.change(input(), { target: { value } });

describe('RenamePlayerModal', () => {
  it('prefills the name and shows the note', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Rename player' })).toBeInTheDocument();
    expect(input()).toHaveValue('Alice');
    expect(input()).toHaveAttribute('maxlength', '100');
    expect(
      screen.getByText('Past tournaments keep the name they were played with.'),
    ).toBeInTheDocument();
  });

  it('disables Save for an empty or unchanged name', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    type('   ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    type(' Alice ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    type('Alicia');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('saves the trimmed name and closes', async () => {
    const { onSave, onClose } = renderModal();
    type('  Alicia ');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith('Alicia');
  });

  it('warns on another player name and saves on "Rename anyway"', async () => {
    const { onSave, onClose } = renderModal();
    type('CARMEN');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Another player is already called CARMEN.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Rename anyway' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith('CARMEN');
  });

  it('keeps the modal open with the error on failure', async () => {
    const onSave = vi.fn<OnSave>(async () => err({ code: 'UNAVAILABLE', message: 'offline' }));
    const { onClose } = renderModal(onSave);
    type('Alicia');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Could not rename (UNAVAILABLE): offline')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Rename player' })).toBeInTheDocument();
  });
});
