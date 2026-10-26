import { MantineProvider } from '@mantine/core';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import {
  pairTopCutRound,
  reduce,
  type MatchResult,
  type RoundPairedPayload,
  type TournamentState,
} from '../../domain';
import {
  CREATED_PAYLOAD,
  TOURNAMENT_ID,
  WIN_A,
  playerIds,
  swissHistory,
  uuid,
  type LogBuilder,
} from '../../domain/fixtures/builders';
import { TopCutPanel } from './TopCutPanel';

const ids = playerIds(8);
const WIN_B: MatchResult = { winsA: 1, winsB: 2, draws: 0, kind: 'played' };

/**
 * 8 players, one swiss round (1 v 2, 3 v 4…, A wins), then TopCutStarted. Ties keep name order,
 * so the seeds are players 1, 3, 5, 7, 2, 4, 6, 8.
 */
function started(size: 4 | 8, bestOf: 3 | 5 = 3): LogBuilder {
  return swissHistory(
    ids,
    [
      [
        [ids[0], ids[1]],
        [ids[2], ids[3]],
        [ids[4], ids[5]],
        [ids[6], ids[7]],
      ],
    ],
    { ...CREATED_PAYLOAD, swissRounds: 1 },
  ).add('TopCutStarted', { size, bestOf });
}

let nextId = 0;
const stateOf = (log: LogBuilder) => reduce(log.events, TOURNAMENT_ID);

function pair(log: LogBuilder): RoundPairedPayload {
  const result = pairTopCutRound(stateOf(log), {
    random: () => 0.999,
    newId: () => uuid(7000 + ++nextId),
  });
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  log.add('RoundPaired', result.value);
  return result.value;
}

function play(log: LogBuilder, results: MatchResult[] = []) {
  const payload = pair(log);
  for (const [i, p] of payload.pairings.entries()) {
    log.add('ResultReported', { matchId: p.matchId, result: results[i] ?? WIN_A });
  }
  log.add('RoundClosed', { round: payload.round });
}

function renderPanel(state: TournamentState) {
  render(
    <MantineProvider env="test">
      <MemoryRouter>
        <TopCutPanel state={state} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

const placingRows = () =>
  within(screen.getByRole('table', { name: 'Top cut placings' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );

describe('TopCutPanel', () => {
  it('shows the size and best-of', () => {
    renderPanel(stateOf(started(4, 5)));
    expect(screen.getByRole('heading', { name: 'Top 4 · Best of 5' })).toBeInTheDocument();
  });

  it('explains the empty bracket before the first top cut round', () => {
    renderPanel(stateOf(started(4)));
    expect(
      screen.getByText('Pair the first top cut round to see the bracket.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Top cut placings' })).not.toBeInTheDocument();
  });

  it('shows the empty bracket after a rollback past the first top cut round', () => {
    const log = started(4);
    const startedSeq = log.events.length;
    play(log);
    log.add('RolledBack', { toSeq: startedSeq });
    renderPanel(stateOf(log));
    expect(
      screen.getByText('Pair the first top cut round to see the bracket.'),
    ).toBeInTheDocument();
  });

  /** A bracket line ("(seed) name"): the name is a link inside the line's element. */
  const line = (text: string) => (_: string, element: Element | null) =>
    element?.textContent === text && ['STRONG', 'P'].includes(element.tagName);

  it('shows one column per round with seeds, names, scores and bold winners', () => {
    const log = started(4);
    play(log, [WIN_A, WIN_B]); // semifinals: 1 v 7 (player 1 wins), 3 v 5 (player 5 wins)
    pair(log); // final, not reported
    renderPanel(stateOf(log));

    const semis = within(screen.getByRole('group', { name: 'Semifinals' }));
    const table1 = within(semis.getByRole('group', { name: 'Table 1' }));
    expect(table1.getByText(line('(1) Player 1')).tagName).toBe('STRONG');
    expect(table1.getByText(line('(4) Player 7')).tagName).not.toBe('STRONG');
    expect(table1.getByText('2-1')).toBeInTheDocument();
    const table2 = within(semis.getByRole('group', { name: 'Table 2' }));
    expect(table2.getByText(line('(3) Player 5')).tagName).toBe('STRONG');
    expect(table2.getByText('1-2')).toBeInTheDocument();

    const final = within(screen.getByRole('group', { name: 'Final' }));
    expect(final.getByText(line('(1) Player 1'))).toBeInTheDocument();
    expect(final.getByText(line('(3) Player 5'))).toBeInTheDocument();
    expect(final.getByText('Not reported')).toBeInTheDocument();
  });

  it('places a finished Top 8: 1st, 2nd, 3rd–4th and 5th–8th', () => {
    const log = started(8);
    play(log); // quarterfinals: seeds 1, 4, 2, 3 win
    play(log); // semifinals: seeds 1 and 2 win
    play(log, [WIN_B]); // final: seed 2 (player 3) wins
    log.add('TournamentFinished', {});
    renderPanel(stateOf(log));

    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(
      expect.arrayContaining(['Quarterfinals', 'Semifinals', 'Final']),
    );
    expect(placingRows()).toEqual([
      ['1st', 'Player 3', '—', '2'],
      ['2nd', 'Player 1', '—', '1'],
      ['3rd–4th', 'Player 5', '—', '3'],
      ['3rd–4th', 'Player 7', '—', '4'],
      ['5th–8th', 'Player 2', '—', '5'],
      ['5th–8th', 'Player 4', '—', '6'],
      ['5th–8th', 'Player 6', '—', '7'],
      ['5th–8th', 'Player 8', '—', '8'],
    ]);
  });

  it('shows archetypes under bracket names and in the placings Deck column', () => {
    const log = started(4).add('DeckSet', {
      playerId: ids[0],
      archetype: 'Burn',
      main: [],
      sideboard: [],
    });
    play(log); // semifinals: 1 v 7, 3 v 5
    log.add('TournamentFinished', {});
    renderPanel(stateOf(log));

    const table1 = within(
      within(screen.getByRole('group', { name: 'Semifinals' })).getByRole('group', {
        name: 'Table 1',
      }),
    );
    expect(table1.getByText('Burn')).toBeInTheDocument();
    expect(table1.getAllByText(/Burn|—/)).toHaveLength(1);
    expect(placingRows().map((row) => [row[1], row[2]])).toEqual([
      ['Player 1', 'Burn'],
      ['Player 3', '—'],
      ['Player 5', '—'],
      ['Player 7', '—'],
    ]);
  });

  it('shares 1st–2nd between the finalists when finished after the semifinals', () => {
    const log = started(4);
    play(log);
    log.add('TournamentFinished', {});
    renderPanel(stateOf(log));

    expect(placingRows().map(([placeText]) => placeText)).toEqual([
      '1st–2nd',
      '1st–2nd',
      '3rd–4th',
      '3rd–4th',
    ]);
  });

  it('links registry players in the bracket and the placings, and not guests', () => {
    const log = started(4);
    play(log, [WIN_A, WIN_B]);
    const state = stateOf(log);
    // Player 7 (seed 4) as a guest.
    state.players[ids[6]] = { ...state.players[ids[6]], guest: true };
    renderPanel(state);

    const semis = within(screen.getByRole('group', { name: 'Semifinals' }));
    expect(semis.getByRole('link', { name: 'Player 1' })).toHaveAttribute(
      'href',
      `/players/${ids[0]}`,
    );
    expect(semis.queryByRole('link', { name: 'Player 7' })).not.toBeInTheDocument();
    const placings = within(screen.getByRole('table', { name: 'Top cut placings' }));
    expect(placings.getByRole('link', { name: 'Player 5' })).toHaveAttribute(
      'href',
      `/players/${ids[4]}`,
    );
    expect(placings.getByText('Player 7')).toBeInTheDocument();
    expect(placings.queryByRole('link', { name: 'Player 7' })).not.toBeInTheDocument();
  });
});
