/** Returns a new random UUID (v4). Built into browsers and Node 24. */
export function newId(): string {
  return crypto.randomUUID();
}
