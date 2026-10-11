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

| Event                | Payload                                       |
| -------------------- | --------------------------------------------- |
| `TournamentCreated`  | name, date, location, format, swissRounds     |
| `PlayerRegistered`   | playerId, playerName, optional deckId         |
| `PlayerDropped`      | playerId                                      |
| `RoundPaired`        | round, stage (`swiss` or `topCut`), pairings  |
| `ResultReported`     | matchId, result (games won A/B, draws, kind)  |
| `RoundClosed`        | round                                         |
| `TopCutStarted`      | size (4, 8, 16 or 32)                         |
| `TournamentFinished` | (none)                                        |
| `RolledBack`         | toSeq: cancels every effective event after it |

`Player` is a global entity shared across tournaments. Decks are defined in a later spec.

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
| Planned (later specs) | Zod, Zustand, Dexie (IndexedDB), Octokit, `vite-plugin-pwa`       |

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

Project foundation in place: an empty app that builds, lints, tests and deploys. Domain features are next.

## License

TBD.
