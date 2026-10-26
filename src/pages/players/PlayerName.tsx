import { Anchor } from '@mantine/core';
import { Link } from 'react-router';
import type { Uuid } from '../../domain';

/** A registry player's name links to the profile; a guest's name is plain text. */
export function PlayerName({
  playerId,
  name,
  guest,
}: {
  playerId: Uuid;
  name: string;
  guest: boolean;
}) {
  if (guest) {
    return <>{name}</>;
  }
  return (
    <Anchor component={Link} to={`/players/${playerId}`} inherit>
      {name}
    </Anchor>
  );
}
