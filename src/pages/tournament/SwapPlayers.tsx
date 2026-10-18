import { Button, Group, Select } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Command, DomainError, Result, Round, TournamentState } from '../../domain';

type Props = {
  state: TournamentState;
  /** The open swiss round. */
  round: Round;
  onDispatch: (cmd: Command) => Result<TournamentState, DomainError>;
};

type Seat = { playerId: string; opponent: string | null };

/** Same order as the player lists: English collation, then id. */
const collator = new Intl.Collator('en');

/** "Swap players": two selects that trade two players' seats in the open round. */
export function SwapPlayers({ state, round, onDispatch }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);

  // Active players whose match has no reported result. A bye counts as unreported.
  const seats = round.matches
    .filter((match) => match.playerB === null || match.result === null)
    .flatMap((match): Seat[] =>
      match.playerB === null
        ? [{ playerId: match.playerA, opponent: null }]
        : [
            { playerId: match.playerA, opponent: match.playerB },
            { playerId: match.playerB, opponent: match.playerA },
          ],
    )
    .filter((seat) => state.players[seat.playerId]?.dropped === false)
    .map((seat) => ({ ...seat, name: state.players[seat.playerId].playerName }))
    .sort(
      (a, b) =>
        collator.compare(a.name, b.name) ||
        (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
    );

  const firstSeat = seats.find((seat) => seat.playerId === first);
  const options = (exclude: Array<string | null | undefined>) =>
    seats
      .filter((seat) => !exclude.includes(seat.playerId))
      .map((seat) => ({ value: seat.playerId, label: seat.name }));

  function close() {
    setOpen(false);
    setFirst(null);
    setSecond(null);
  }

  function swap() {
    if (first === null || second === null) {
      return;
    }
    const result = onDispatch({
      type: 'PlayersSwapped',
      payload: { round: round.number, playerA: first, playerB: second },
    });
    if (result.ok) {
      close();
    }
  }

  if (!open) {
    return (
      <Button variant="light" w="fit-content" onClick={() => setOpen(true)}>
        {t('tournament.rounds.swap.open')}
      </Button>
    );
  }

  return (
    <Group align="flex-end" gap="sm">
      <Select
        label={t('tournament.rounds.swap.first')}
        data={options([])}
        value={first}
        onChange={(value) => {
          setFirst(value);
          setSecond(null);
        }}
        searchable
        w={220}
      />
      <Select
        label={t('tournament.rounds.swap.second')}
        data={options([first, firstSeat?.opponent])}
        value={second}
        onChange={setSecond}
        disabled={first === null}
        searchable
        w={220}
      />
      <Button onClick={swap} disabled={first === null || second === null}>
        {t('tournament.rounds.swap.confirm')}
      </Button>
      <Button variant="default" onClick={close}>
        {t('tournament.rounds.swap.cancel')}
      </Button>
    </Group>
  );
}
