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
| `TopCutStarted`            | size (4, 8, 16 or 32), optional bestOf (3 or 5; missing = 3)    |
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
  per player and 3 games in total (`fitsBestOf` in `src/domain/schemas/matchResult.ts`). Top
  cut matches are best of three or five, chosen when the top cut starts.
- **Swiss pairing** (`src/domain/pairing.ts`):
  - Round 1 is random. Later rounds pair players with the same match points, in random
    order, and the odd player of a group floats down to the next one.
  - Rematches are avoided by backtracking. When no round without rematches exists, the
    pairing with the fewest is used and the round shows a warning.
  - With an odd number of players, the bye goes to the lowest match points among players
    without a bye (random among ties).
  - Tables are numbered from the top: the highest points play at table 1, and the bye gets
    the last table.

## Standings and tiebreakers

Swiss standings follow MTR Appendix C (`src/domain/standings.ts`). They count closed swiss
rounds only: the open round's reported results and top cut rounds never change them.

- **Order:** match points, then OMW%, GW% and OGW%, all descending. Percentages closer than
  `1e-9` are equal.
- **MW%:** match points / (3 × rounds played), at least 33%. A bye is a played round (a win).
  A late entry's missed rounds do not count.
- **GW%:** (3 × games won + drawn games) / (3 × games played), at least 33%. A bye is a 2-0.
  Intentional draws and unplayed matches add no games.
- **OMW% / OGW%:** the mean of each opponent's floored MW% / GW%, one entry per match. Byes are
  not opponents. With no opponents they are 33%. Dropped opponents count with the rounds they
  played.
- **Ties:** players equal on every tiebreaker share the rank (1, 2, 2, 4) and are listed by
  name. Dropped players and late entries are ranked like everyone else.

## Top cut

The top cut is optional single elimination, started after any closed swiss round
(`src/domain/topCut.ts`).

- **Size:** Top 4, 8, 16 or 32, never more than the active players. The default comes from the
  active players: fewer than 8 none (Top 4 is preselected with a hint), 8–16 Top 4, 17–32 Top 8,
  33–64 Top 16, 65+ Top 32.
- **Best of:** three or five, stored on `TopCutStarted`. Results must have a winner and fit the
  best-of; the domain refuses others (`TOP_CUT_DRAW`, `RESULT_EXCEEDS_BEST_OF`).
- **Seeding:** the swiss standings after the last closed swiss round, active players only.
  Players tied on every tiebreaker are ordered at random (MTR style), including a tie at the cut
  line. The first top cut round stores the draw, so a replay gives the same bracket.
- **Bracket:** standard order (Top 8: 1v8, 4v5, 2v7, 3v6), so seeds 1 and 2 can only meet in the
  final. Each later round pairs the winners of tables 1–2, 3–4… of the previous one; the better
  seed is the first player. The domain checks the bracket shape and that winners advance, not the
  seeding.
- **During the top cut:** no drops, late entries, swaps or redo pairings. A player who leaves
  concedes: report the opponent's win. Rollback (History) fixes mistakes.
- **Placings:** winner of the final 1st, its loser 2nd, semifinal losers 3rd–4th, quarterfinal
  losers 5th–8th, and so on. Players still in when the tournament finishes share 1st–Nth.

## Player statistics

Each tournament summary stores one result per registry player (`playerResults` in
`src/domain/playerStats.ts`), computed when the summary is computed. The players page and the
profile add these up and never replay an event log.

- **Who:** registry players only. Guests have no statistics; a match against a guest counts like
  any other.
- **Which tournaments:** every stored tournament, any status, where the player is registered
  (dropped or not, even with no match). Only matches with a result count, so a running event
  adds its reported matches.
- **Which matches:** swiss and top cut. Byes and unplayed matches add no match, game or win
  rate; byes are counted on their own. An intentional draw is a draw with no games.
- **Match win %:** wins / (wins + losses + draws). **Game win %:** games won / games played,
  drawn games included. No 33% floor (that is for tiebreakers only). "—" when there is nothing
  to count.
- **Swiss rank:** the rank in the standings after the last closed swiss round. **Top cut
  place:** as in the placings table.

## Restore, rollback and redo pairings

- **Restore:** every change is saved as it happens. Opening a tournament from the list replays
  its event log, so it continues exactly where it stopped. There is no separate restore step.
- **Rollback:** "Roll back to here" on a History row appends one `RolledBack` event. Every event
  after that row is voided: it stays in the log, dimmed with an "Undone" badge, but no longer
  counts. Nothing is ever deleted, and an undone event cannot be restored. Rolling back past
  "Close round N" reopens that round, and past "Finish tournament" returns it to running.
- **Redo pairings:** while a swiss round is open, "Redo pairings" pairs the same round again. It
  voids the round's results and swaps, and keeps the drops, registrations and detail changes
  made during the round (they are appended again after the rollback). So a late arrival is
  paired and a dropped player is not. The rollback, the carried events and the new pairing are
  saved together: if the pairing fails, nothing changes. To redo a closed round, roll back past
  "Close round N" first.

## Screens

Every page renders inside one app shell with navigation (Tournaments, Players, Data, Settings). Pages are
loaded lazily, one chunk each.

- **Tournaments (`/#/`):** every stored tournament with date, format, status and player count,
  read from the summary rows only. "New tournament" opens the create form.
- **New tournament (`/#/tournaments/new`):** name, date (today by default), location, format and
  swiss rounds: "Auto" (fixed from the player count when round 1 is paired) or a custom number.
- **Tournament (`/#/tournaments/<id>`):**
  - **Details:** inline edit of the fields the current status allows, and a "Recommended rounds"
    table with the row for the current player count highlighted.
  - **Round controls:** "Pair round N" (random round 1, then by match points; in the top cut, the
    next bracket round until the final), "Close round N" once every result is in, "Redo
    pairings" (with confirmation) while a swiss round is open, "Start top cut" after any closed
    swiss round with at least 4 active players, and "Finish tournament" (with confirmation) after
    any closed round.
  - **Start top cut:** size (default from the player count), best of 3 or 5, and the seeds with
    their match points. Tied players carry a "Tied" badge, and a tie at the cut line is named.
    Confirming starts the top cut and pairs its first round in one save.
  - **Tabs:** "Players" (registration), "Standings", "Top cut" (once it has started), one tab per
    round, and "History". Top cut round tabs are named "Quarterfinals", "Semifinals", "Final"
    (and "Round of 16", "Round of 32"). The open round opens by default.
  - **Top cut tab:** the bracket, one column per round, with "(seed) name", the score and the
    winner in bold, and the placings table.
  - **Standings tab:** rank, player, MP, W-L-D, OMW%, GW% and OGW% (2 decimals), with a
    "Dropped" badge. "After round" picks any closed swiss round (the last one by default).
    Before round 1 is closed it says so.
  - **History tab:** every event, newest first, with its number, a label ("Round 2: Ana 2-1
    Ben") and its time. Undone events are dimmed. "Roll back to here" opens a confirmation with
    the count of undone events per type and the status and round after the rollback.
  - **Round tab:** one row per match with one-click results (2-0, 2-1, 1-2, 0-2, 1-1-1, ID,
    Unplayed) or a custom best-of-three score, always from the first player's side. A result
    can be changed until the round is closed. Each player shows points and W-L-D from earlier
    rounds. "By player" lists everyone alphabetically with table and opponent. "Swap players"
    trades two players' seats in matches without a result. Rematches and repeated byes show as
    warnings. In the top cut the one-click results are winner-only for the best-of (best of five:
    3-0, 3-1, 3-2, 2-3, 1-3, 0-3), with no draw, ID or Unplayed.
  - **Registration:** the player registry on the left, registered players on the right. Click a
    player (or filter and press Enter) to register them; "Remove" undoes a registration in setup.
    "New player" adds to the registry and registers; "Add guest" registers for this tournament
    only. A name that already exists needs a second Enter. While running, late entries are
    allowed and "Drop" asks for confirmation.
  - **Autosave:** every change is applied at once and saved in order. If another tab saved first,
    or the tournament was deleted elsewhere, the page reloads the stored version and says so. If
    the save cannot reach the storage (no network), the change stays on the page with "Not saved"
    and a "Retry save" button; no other change is accepted until it is saved.
- **Players (`/#/players`):** every registry player with tournaments played, record (W-L-D),
  match win %, game win % and last played date. "Search" filters by name; every column header
  sorts (click again to flip), and empty values ("—") stay last. Guests are never listed.
- **Player profile (`/#/players/<id>`):** totals (tournaments, record, win rates, byes, top cuts
  and best top cut finish), a "By format" table, and the tournament history with date, format,
  status, swiss record (plus byes), swiss rank and top cut place, with a "Dropped" badge.
  "Rename" changes the registry name (another player's name needs "Rename anyway"); past
  tournaments keep the name they were played with. Player names in Standings, the registered
  list, the read-only registry list, the bracket and the placings link here; guests do not.
- **Data (`/#/data`):** the active storage, export, import and delete (see below).
- **Settings (`/#/settings`):** choose where data is stored: this browser or a GitHub
  repository (see [GitHub storage](#github-storage)).

## Storage

The storage layer lives in `src/storage/`. Callers use the `StorageBackend` interface returned by
`getStorage()`. Two backends implement it: this browser (IndexedDB through Dexie, database
`modotorneo`, the default) and a GitHub repository. The backend is chosen on the Settings page
and read once per page load (`localStorage` key `modotorneo.storage`).

- **Tables:** `tournaments` (one row per tournament: the whole `TournamentDocument` plus summary
  fields recomputed on every save, including `playerCount` and the per-player results `players`)
  and `players` (the global player registry). Schema changes are new Dexie versions with an
  upgrade function (now version 4: version 3 adds the GitHub summary cache `githubSummaries`,
  version 4 adds the per-player results to every row and clears that cache).
- **Validation:** every document is checked with `parseTournamentDocument` on save and on load. A
  corrupted row is reported as `INVALID_DOCUMENT`, never loaded silently.
  Players are checked with `PlayerSchema` the same way; an invalid player is `INVALID_PLAYER`.
- **Revisions:** each save takes the revision it expects (`null` to create) and returns the new
  one. A mismatch returns `CONFLICT`, so two tabs cannot overwrite each other.
- **Persistence:** the app asks the browser for persistent storage on start
  (`navigator.storage.persist()`). Browsers can still clear site data, so export backups regularly.

### GitHub storage

With GitHub storage every save is one commit to a private data repository, so the whole history
is versioned and available on any device.

**Repository layout** (default branch):

```text
tournaments/<id>.json   # one TournamentDocument per tournament (the same file as a single export)
players.json            # { kind: 'modotorneo-players', schemaVersion: 1, players } sorted by id
```

**Set up** (step-by-step guide for new users, with troubleshooting:
[docs/github-storage-setup.md](docs/github-storage-setup.md)):

1. Create a new **private** repository on GitHub (for example `mtg-data`). It can stay empty.
2. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - Repository access: **Only select repositories**, and pick the data repository only.
   - Repository permissions: **Contents: Read and write** (Metadata: Read-only is added
     automatically). Nothing else.
   - An expiration date you are comfortable with. When it expires, create a new one and connect
     again.
3. In ModoTorneo, open **Settings**, enter the owner, the repository name and the token, and click
   **Test connection**. A public repository works but shows a warning: player names will be
   visible to anyone.
4. Click **Connect**. The app reloads and now reads and writes the repository.

**Moving data** between this browser and GitHub: before connecting, export a full backup on the
Data page; after connecting, import it. The same works in the other direction. Connect and
Disconnect never touch the data stored in this browser.

**How it works:**

- Requests go straight from the browser to the GitHub REST API (Contents API) with `fetch`; there
  is no server. The token is kept only in this browser's `localStorage`, sent only in the
  `Authorization` header, and never written to files, messages or exports. "Disconnect" removes
  it.
- The blob SHA of each file is its revision: GitHub refuses a write with an old SHA, so another
  device's save is detected as a conflict and the page reloads the stored version.
- The tournament list reads the `tournaments/` folder and caches each summary in IndexedDB by
  SHA, so only files that changed are downloaded.
- Commit messages: `Save <tournament> (<n> events)`, `Delete <tournament>`,
  `Save player <name>`.

**Errors:** a rejected token shows "GitHub rejected the token" with a link to Settings. No network,
a GitHub outage or the rate limit show "Cannot reach GitHub"; on the tournament page the unsaved
change is kept until "Retry save" succeeds.

### Data page and file formats

The Data page (`/#/data`) shows the active storage, lists stored tournaments and handles export,
import and delete. It works the same on both backends. The persistent storage line shows only
with browser storage.

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

| Service      | Use                                     | Notes                                                       |
| ------------ | --------------------------------------- | ----------------------------------------------------------- |
| GitHub API   | Persist tournament data in a repository | Fine-grained token for one repository, kept in the browser. |
| Moxfield     | Import decklists from a deck URL        | No official public API; may need a text-export fallback.    |
| Scryfall API | Card data and images                    | Public API with rate limits.                                |
| MTGTop8      | Publish results (future)                | No public API known; likely manual export format.           |

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
| GitHub API client     | Plain `fetch` (no Octokit)                                        |
| Planned (later specs) | `vite-plugin-pwa`                                                 |

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

- Moxfield integration: direct fetch (CORS limits) vs paste-export fallback.
- Single-TO use vs multiple organizers sharing one data repository.
- Which formats and tiebreaker rules ship first.
- Offline support (PWA) for venues without reliable internet.

## Status

A full swiss event runs in the browser: registration (registry players and guests, late entries,
drops), swiss pairings, result entry, swaps, standings with MTR tiebreakers and finishing, all
autosaved to IndexedDB. The History tab rolls back to any earlier event, and "Redo pairings"
re-pairs the open swiss round. An optional Top 4 / 8 / 16 / 32 (best of three or five) runs to a
final with a bracket and placings. A players page and a profile per registry player show match
and game win rates, overall and per format, and the tournament history. Data can be stored in the browser or in a private GitHub
repository (one commit per save), chosen on the Settings page.

## License

TBD.
