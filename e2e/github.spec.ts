import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { FakeGitHub } from '../src/test/fakeGitHub.ts';

const TOKEN = 'github_pat_e2e_secret_token';
const PLAYERS = ['Ana', 'Bóris', 'Cleo', 'Dan'];

/** Serves every GitHub API request from the in-memory fake. */
async function routeGitHub(page: Page, fake: FakeGitHub) {
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const response = fake.handle({
      method: request.method(),
      url: request.url(),
      headers: request.headers(),
      body: request.postData(),
    });
    if (response === null) {
      await route.abort('internetdisconnected');
      return;
    }
    await route.fulfill(response);
  });
}

function putMessages(fake: FakeGitHub): string[] {
  return fake.requestsTo('PUT').map((r) => (r.body as { message: string }).message);
}

function tournamentFile(fake: FakeGitHub): { id: string; events: Array<{ type: string }> } {
  const path = fake.paths().find((p) => p.startsWith('tournaments/'));
  return JSON.parse(fake.getFile(path!)!);
}

async function createTournament(page: Page, name: string) {
  await page.goto('./#/tournaments/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: 'Pauper' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test('connects to GitHub, saves every change, survives a lost connection and disconnects', async ({
  page,
}) => {
  const fake = new FakeGitHub({ token: TOKEN });
  await routeGitHub(page, fake);

  // A tournament stored in this browser before connecting.
  await createTournament(page, 'Local Cup');

  // Connect on the Settings page.
  await page.goto('./#/settings');
  await expect(page.getByText('Storage: this browser')).toBeVisible();
  await page.getByRole('textbox', { name: 'Owner' }).fill('alice');
  await page.getByRole('textbox', { name: 'Repository' }).fill('mtg-data');
  await page.getByLabel('Fine-grained token').fill(TOKEN);
  const connect = page.getByRole('button', { name: 'Connect', exact: true });
  await expect(connect).toBeDisabled();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('alert')).toHaveText('Connected to alice/mtg-data.');
  await connect.click();

  // The page reloads at the list, now on GitHub (empty repository).
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText('No tournaments yet. Create one to get started.')).toBeVisible();
  await page.goto('./#/data');
  await expect(page.getByText('Storage: GitHub (alice/mtg-data)')).toBeVisible();
  await expect(page.getByText(/^Persistent storage/)).toBeHidden();
  await page.goto('./#/settings');
  await expect(page.getByText('Storage: GitHub (alice/mtg-data)')).toBeVisible();

  // Create a tournament, register players, pair and enter a result.
  await createTournament(page, 'GitHub Cup');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect(putMessages(fake)).toEqual(['Save GitHub Cup (1 events)']);

  const newPlayer = page.getByRole('textbox', { name: 'New player' });
  for (const name of PLAYERS) {
    await newPlayer.fill(name);
    await newPlayer.press('Enter');
    await expect(newPlayer).toHaveValue('');
  }
  await expect(page.getByRole('heading', { name: 'Registered (4)' })).toBeVisible();
  await page.getByRole('button', { name: 'Pair round 1' }).click();
  const tables = page.getByRole('group', { name: /^Table \d+$/ });
  await expect(tables).toHaveCount(2);
  const first = tables.first().getByRole('button', { name: '2-1', exact: true });
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // One PUT per accepted command: created, 4 registrations, pairing, result.
  const tournamentSaves = putMessages(fake).filter((m) => m.startsWith('Save GitHub Cup'));
  expect(tournamentSaves).toEqual(
    [1, 2, 3, 4, 5, 6, 7].map((n) => `Save GitHub Cup (${n} events)`),
  );
  expect(putMessages(fake).filter((m) => m.startsWith('Save player'))).toHaveLength(4);
  const players = JSON.parse(fake.getFile('players.json')!) as { players: Array<{ name: string }> };
  expect(players.players.map((p) => p.name).sort()).toEqual([...PLAYERS].sort());
  expect(tournamentFile(fake).events.at(-1)?.type).toBe('ResultReported');

  // The stored file is the single-tournament export of the document.
  const tournamentUrl = page.url();
  await page.goto('./#/data');
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('row', { name: /GitHub Cup/ })
    .getByRole('button', { name: 'Export' })
    .click();
  const exported = await readFile(await (await downloadPromise).path(), 'utf8');
  expect(JSON.parse(exported)).toEqual(tournamentFile(fake));
  expect(exported).not.toContain(TOKEN);

  // A reload reads everything back from GitHub.
  await page.goto(tournamentUrl);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'GitHub Cup', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Round 1' }).click();
  await expect(tables.first().getByRole('button', { name: '2-1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The connection drops: the result stays on screen, unsaved, and new commands are refused.
  fake.offline = true;
  const second = tables.nth(1).getByRole('button', { name: '0-2', exact: true });
  await second.click();
  await expect(
    page.getByText(/^Not saved: .*\. Your changes are kept on this page\.$/),
  ).toBeVisible();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Not saved', { exact: true })).toBeVisible();
  const draw = tables.first().getByRole('button', { name: '1-1-1', exact: true });
  await draw.click();
  await expect(draw).toHaveAttribute('aria-pressed', 'false');
  expect(tournamentFile(fake).events).toHaveLength(7);

  // The connection returns: Retry save stores the kept document.
  fake.offline = false;
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeHidden();
  expect(tournamentFile(fake).events).toHaveLength(8);
  // The next command saves normally.
  await draw.click();
  await expect(draw).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect.poll(() => tournamentFile(fake).events.length).toBe(9);

  // Another device saves first: the stale SHA is a conflict, and the page reloads the stored file.
  const path = fake.paths().find((p) => p.startsWith('tournaments/'))!;
  fake.setFile(
    path,
    `${fake.getFile(path)!.trimEnd()}

`,
  );
  await tables.nth(1).getByRole('button', { name: '2-0', exact: true }).click();
  await expect(
    page.getByText(
      'This tournament was changed in another tab. Your last change was not saved. The latest version has been loaded.',
    ),
  ).toBeVisible();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(tournamentFile(fake).events).toHaveLength(9);

  // The token is only ever sent in the Authorization header.
  for (const request of fake.requests) {
    expect(`${request.url} ${JSON.stringify(request.body)}`).not.toContain(TOKEN);
  }

  // Disconnect: back to this browser, where the local tournament is still stored.
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('link', { name: 'Local Cup' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHub Cup' })).toBeHidden();
  await page.goto('./#/settings');
  await expect(page.getByText('Storage: this browser')).toBeVisible();
});

test('a rejected token sends the organizer to Settings', async ({ page }) => {
  const fake = new FakeGitHub({ token: TOKEN });
  await routeGitHub(page, fake);
  await page.goto('./');
  await page.evaluate(
    (token) =>
      localStorage.setItem(
        'modotorneo.storage',
        JSON.stringify({ backend: 'github', owner: 'alice', repo: 'mtg-data', token }),
      ),
    TOKEN,
  );
  fake.token = 'rotated';
  await page.reload();
  await expect(
    page.getByText('GitHub rejected the token. Check it on the Settings page.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Open Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});
