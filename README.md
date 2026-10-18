# ModoTorneo

A web application for organizing and running Magic: The Gathering tournaments, tracking player history, and analyzing the metagame.

ModoTorneo is hosted as a static site on GitHub Pages. Tournament data can be stored locally in the browser/on disk, or persisted to a GitHub repository, so a tournament organizer (TO) can resume an event, roll back results, redo pairings, and browse past tournaments.

## Goals

- Run a full tournament from registration to final standings in the browser.
- Never lose tournament state: every change is saved and reversible.
- Keep a long-term record of players, decks, and results.
- Turn that record into useful player and metagame statistics.

## Core Features

### 1. Tournament Management

- Create a tournament: name, date, location, format (Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Commander, Limited, etc.), structure, and number of rounds.
- Player registration, late entries, drops.
- Swiss pairings with standard MTG rules (avoid rematches, byes for odd player counts, pair within point groups).
- Optional top-cut single elimination (Top 4 / 8 / 16 / 32), chosen when the swiss rounds end.
- Match result entry (e.g. 2-0, 2-1, 1-1-1, draws, unplayed/intentional draws).
- Standings with official tiebreakers: Match Points, Opponents' Match Win % (OMW%), Game Win % (GW%), Opponents' Game Win % (OGW%).
- Round timer (nice to have).

### 2. State, History, and Rollback

- Every action (pairing generated, result entered, player dropped) is recorded as an event in an append-only log.
- The TO can:
  - **Restore** an in-progress tournament and continue where it stopped.
  - **Roll back** to any previous point (e.g. undo a wrong result).
  - **Redo matchmaking** for the current round after a correction.
- Finished tournaments remain browsable for historical reference.

### 3. Storage

Two storage backends, selectable by the user:

- **Local storage:** data stays in the browser (IndexedDB/localStorage), with import/export to a JSON file for backup and sharing.
- **GitHub storage:** data is committed as JSON files to a GitHub repository via the GitHub API, using a user-provided access token. This gives free versioning, history, and multi-device access.

Data format is plain, documented JSON so it is human-readable and diff-friendly in git.

### 4. Player History and Statistics

- Persistent player profiles across tournaments.
- Per-player match and game win rates, overall and **per format**.
- Tournament history per player: placements, records, decks played.
- Head-to-head records (nice to have).

### 5. Deck and Metagame Analysis

- Each registration links a player to a deck with an archetype label (e.g. "Izzet Prowess", "Mono-Red Aggro").
- Decklists can be entered manually, pasted as text, or **linked from deck sites such as Moxfield** to import the list.
- Metagame metrics per format and time range:
  - Archetype share of the field.
  - Archetype match win percentage.
  - Archetype vs archetype matchup matrix.
  - Most played cards across the metagame (and per archetype).
- Card data (names, types, images) can be resolved through the Scryfall API.

## Future Features (Not Core)

- **Publish to MTGTop8:** export or submit tournament results and decklists to mtgtop8.com.
- Public read-only tournament pages for players (pairings, standings).
- Additional pairing structures (round robin, double elimination).
- Charts and dashboards for metagame trends over time.

## Data Model

The domain layer lives in `src/domain/` (pure TypeScript, no framework imports). Zod schemas
and their inferred types are in `src/domain/schemas/`.

Each tournament is stored as a `TournamentDocument` (`{ schemaVersion: 1, id, events }`) holding
an append-only event log. Tournament state is never stored: it is derived by replaying the
events. Events carry a gapless `seq`, which orders the log; `at` is informational only.

| Event                      | Payload                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `TournamentCreated`        | name, date, location, format, swissRounds (`null` = auto)       |
| `PlayerRegistered`         | playerId, playerName, optional deckId, optional guest           |
| `PlayerUnregistered`       | playerId (setup only: removes a mistaken registration)          |
| `PlayerDropped`            | playerId                                                        |
| `TournamentDetailsChanged` | any of name, date, location, format, swissRounds (at least one) |
| `RoundPaired`              | round, stage (`swiss` or `topCut`), pairings                    |
| `PlayersSwapped`           | round, playerA, playerB: trade seats in the open swiss round    |
| `ResultReported`           | matchId, result (games won A/B, draws, kind)                    |
| `RoundClosed`              | round                                                           |
| `TopCutStarted`            | size (4, 8, 16 or 32)                                           |
| `TournamentFinished`       | (none)                                                          |
| `RolledBack`               | toSeq: cancels every effective event after it                   |

- **Auto swiss rounds:** `swissRounds: null` is fixed by the first swiss round, from the number of
  active players (MTR Appendix E, `src/domain/swissRounds.ts`). Late entries do not change it.
- **Editing details:** format can change only in setup. Swiss rounds can change until swiss
  ends, but never below the rounds already paired.
- **Swapping players:** two active players trade seats in the open swiss round, only while
  neither of their matches has a reported result. A swap may move the bye.
- **Guests:** a `PlayerRegistered` with `guest: true` plays in that tournament only. Guests are
  never added to the global player registry.

`Player` is a global entity shared across tournaments. Decks are defined in a later spec.

## Pairing and scoring

- **Match points (MTR):** win 3, draw or intentional draw 1, loss 0. A bye is a 2-0 win (3
  points). An unplayed match is a loss for both players. Top cut rounds do not count
  (`src/domain/points.ts`).
- **Match length:** swiss matches are best of three. A custom result allows at most 2 wins
  per player and 3 games in total (`fitsBestOf` in `src/domain/schemas/matchResult.ts`).
- **Swiss pairing** (`src/domain/pairing.ts`):
  - Round 1 is random. Later rounds pair players with the same match points, in random
    order, and the odd player of a group floats down to the next one.
  - Rematches are avoided by backtracking. When no round without rematches exists, the
    pairing with the fewest is used and the round shows a warning.
  - With an odd number of players, the bye goes to the lowest match points among players
    without a bye (random among ties).
  - Tables are numbered from the top: the highest points play at table 1, and the bye gets
    the last table.

## Screens

Every page renders inside one app shell with navigation (Tournaments, Data). Pages are loaded
lazily, one chunk each.

- **Tournaments (`/#/`):** every stored tournament with date, format, status and player count,
  read from the summary rows only. "New tournament" opens the create form.
- **New tournament (`/#/tournaments/new`):** name, date (today by default), location, format and
  swiss rounds: "Auto" (fixed from the player count when round 1 is paired) or a custom number.
- **Tournament (`/#/tournaments/<id>`):**
  - **Details:** inline edit of the fields the current status allows, and a "Recommended rounds"
    table with the row for the current player count highlighted.
  - **Round controls:** "Pair round N" (random round 1, then by match points), "Close round N"
    once every result is in, and "Finish tournament" (with confirmation) after any closed round.
  - **Tabs:** "Players" (registration) and one tab per round. The open round opens by default.
  - **Round tab:** one row per match with one-click results (2-0, 2-1, 1-2, 0-2, 1-1-1, ID,
    Unplayed) or a custom best-of-three score, always from the first player's side. A result
    can be changed until the round is closed. Each player shows points and W-L-D from earlier
    rounds. "By player" lists everyone alphabetically with table and opponent. "Swap players"
    trades two players' seats in matches without a result. Rematches and repeated byes show as
    warnings.
  - **Registration:** the player registry on the left, registered players on the right. Click a
    player (or filter and press Enter) to register them; "Remove" undoes a registration in setup.
    "New player" adds to the registry and registers; "Add guest" registers for this tournament
    only. A name that already exists needs a second Enter. While running, late entries are
    allowed and "Drop" asks for confirmation.
  - **Autosave:** every change is applied at once and saved in order. If another tab saved first,
    or the tournament was deleted elsewhere, the page reloads the stored version and says so.
- **Data (`/#/data`):** export, import and delete (see below).

## Storage

The storage layer lives in `src/storage/`. Callers use the `StorageBackend` interface returned by
`getStorage()`; today it is backed by IndexedDB through Dexie (database `modotorneo`). A GitHub
backend will implement the same interface later.

- **Tables:** `tournaments` (one row per tournament: the whole `TournamentDocument` plus summary
  fields recomputed on every save, including `playerCount`) and `players` (the global player
  registry). Schema changes are new Dexie versions with an upgrade function (now version 2).
- **Validation:** every document is checked with `parseTournamentDocument` on save and on load. A
  corrupted row is reported as `INVALID_DOCUMENT`, never loaded silently.
  Players are checked with `PlayerSchema` the same way; an invalid player is `INVALID_PLAYER`.
- **Revisions:** each save takes the revision it expects (`null` to create) and returns the new
  one. A mismatch returns `CONFLICT`, so two tabs cannot overwrite each other.
- **Persistence:** the app asks the browser for persistent storage on start
  (`navigator.storage.persist()`). Browsers can still clear site data, so export backups regularly.

### Data page and file formats

The Data page (`/#/data`) lists stored tournaments and handles export, import and delete.

- **One tournament:** `modotorneo-<slug>-<date>.json`, the plain `TournamentDocument`.
- **Full backup:** `modotorneo-backup-<YYYY-MM-DD>.json`, a dataset file:
  `{ kind: 'modotorneo-dataset', schemaVersion: 1, exportedAt, players, tournaments }`.

Import accepts either file and always merges; it never wipes local data. For each tournament:

| Compared with the stored log         | Result                                         |
| ------------------------------------ | ---------------------------------------------- |
| Not stored yet                       | Added                                          |
| Identical                            | Unchanged                                      |
| Stored log is a prefix of the import | Updated (fast-forward)                         |
| Import is a prefix of the stored log | Not applied: older than local                  |
| Logs diverge                         | You choose: skip (default), overwrite, or copy |

A copy keeps every event and only gets a new tournament id. Imported tournaments add their missing
players to the registry; an existing player is never renamed. Deleting a tournament keeps its
players.

## External Integrations

| Service      | Use                                     | Notes                                                     |
| ------------ | --------------------------------------- | --------------------------------------------------------- |
| GitHub API   | Persist tournament data in a repository | Requires a personal access token; never commit the token. |
| Moxfield     | Import decklists from a deck URL        | No official public API; may need a text-export fallback.  |
| Scryfall API | Card data and images                    | Public API with rate limits.                              |
| MTGTop8      | Publish results (future)                | No public API known; likely manual export format.         |

## Tech Stack

| Concern               | Choice                                                            |
| --------------------- | ----------------------------------------------------------------- |
| Language              | TypeScript (strict)                                               |
| UI                    | React + Mantine                                                   |
| Build / dev server    | Vite                                                              |
| Routing               | React Router with hash history (GitHub Pages has no SPA fallback) |
| i18n                  | i18next + react-i18next (English only for now)                    |
| Unit / component      | Vitest + Testing Library + jsdom                                  |
| End-to-end            | Playwright (Chromium)                                             |
| Lint / format         | ESLint (typescript-eslint, react-hooks, jsx-a11y) + Prettier      |
| Package manager       | pnpm, on Node 24 LTS (`.nvmrc`)                                   |
| CI / hosting          | GitHub Actions, deployed to GitHub Pages from `main`              |
| Validation            | Zod (schemas for every persisted JSON)                            |
| Local storage         | Dexie (IndexedDB)                                                 |
| UI state              | Zustand                                                           |
| Forms and dates       | `@mantine/form`, `@mantine/dates` with dayjs                      |
| Planned (later specs) | Octokit, `vite-plugin-pwa`                                        |

## Development

```sh
pnpm install
pnpm dev            # dev server
pnpm build          # type-check and production build to dist/
pnpm preview        # serve dist/
pnpm typecheck      # TypeScript only
pnpm lint           # ESLint
pnpm format         # Prettier (write)
pnpm format:check   # Prettier (check)
pnpm test           # unit and component tests (Vitest)
pnpm test:watch     # Vitest in watch mode
pnpm test:e2e       # Playwright end-to-end tests (builds first when run locally)
```

First e2e run: `pnpm exec playwright install chromium`.

The roadmap and design decisions live in the specs under `specs/`.

## Open Questions for Planning

- GitHub auth: personal access token vs OAuth device flow (static sites cannot hold a client secret).
- Moxfield integration: direct fetch (CORS limits) vs paste-export fallback.
- Single-TO use vs multiple organizers sharing one data repository.
- Which formats and tiebreaker rules ship first.
- Offline support (PWA) for venues without reliable internet.

## Status

A full swiss event runs in the browser: registration (registry players and guests, late entries,
drops), swiss pairings, result entry, swaps and finishing, all autosaved to IndexedDB. Standings
and tiebreakers are next.

## License

TBD.
