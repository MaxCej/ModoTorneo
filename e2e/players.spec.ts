import { expect, test, type Page } from '@playwright/test';

const PLAYERS = ['Ana', 'Ben', 'Cleo'];

async function addName(page: Page, label: 'New player' | 'Add guest', name: string) {
  const input = page.getByRole('textbox', { name: label });
  await input.fill(name);
  await input.press('Enter');
  await expect(input).toHaveValue('');
}

async function createTournament(page: Page, name: string, format: string) {
  await page.goto('./#/tournaments/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: format }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/** Pairs round 1, reports `preset` on both matches and closes it. */
async function playRound1(page: Page, preset: string) {
  await page.getByRole('button', { name: 'Pair round 1' }).click();
  const tables = page.getByRole('group', { name: /^Table \d+$/ });
  await expect(tables).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const button = tables.nth(i).getByRole('button', { name: preset, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Close round 1' }).click();
  await expect(page.getByRole('button', { name: 'Close round 1' })).toBeHidden();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });
const playersTable = (page: Page) => page.getByRole('table', { name: 'Players' });

test('lists registry players, opens a profile and renames the player', async ({ page }) => {
  // Modern: three new registry players and one guest.
  await createTournament(page, 'Modern Cup', 'Modern');
  for (const name of PLAYERS) {
    await addName(page, 'New player', name);
  }
  await addName(page, 'Add guest', 'Gus');
  await expect(page.getByRole('heading', { name: 'Registered (4)' })).toBeVisible();
  await playRound1(page, '2-0');

  // Pauper: the same registry players and a new guest.
  await createTournament(page, 'Pauper Cup', 'Pauper');
  for (const name of PLAYERS) {
    await page.getByRole('button', { name: `Add ${name}` }).click();
  }
  await addName(page, 'Add guest', 'Gus');
  await expect(page.getByRole('heading', { name: 'Registered (4)' })).toBeVisible();
  await playRound1(page, '2-1');

  // Players page: the three registry players, no guest.
  await nav(page).getByRole('link', { name: 'Players' }).click();
  await expect(page.getByRole('heading', { name: 'Players', level: 1 })).toBeVisible();
  const rows = playersTable(page).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('td:first-child')).toHaveText(PLAYERS);
  await expect(playersTable(page).getByText('Gus')).toHaveCount(0);

  await playersTable(page).getByRole('button', { name: 'Match win %' }).click();
  await expect(
    playersTable(page).getByRole('columnheader', { name: 'Match win %' }),
  ).toHaveAttribute('aria-sort', 'descending');
  const rates = await rows.locator('td:nth-child(4)').allInnerTexts();
  const values = rates.map((rate) => Number.parseFloat(rate));
  expect(values).toEqual([...values].sort((a, b) => b - a));

  // Profile from a Standings name in the pauper event.
  await nav(page).getByRole('link', { name: 'Tournaments' }).click();
  await page.getByRole('link', { name: 'Pauper Cup' }).click();
  await page.getByRole('tab', { name: 'Standings' }).click();
  await page
    .getByRole('table', { name: 'Standings after round 1' })
    .getByRole('link', { name: 'Ana' })
    .click();
  await expect(page.getByRole('heading', { name: 'Ana', level: 1 })).toBeVisible();
  await expect(page.getByRole('table', { name: 'By format' }).locator('tbody tr')).toHaveCount(2);
  await expect(
    page.getByRole('table', { name: 'Tournament history' }).locator('tbody tr'),
  ).toHaveCount(2);

  // Rename, reload: the new name on the players page, the old one in the tournament.
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Anna');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Anna', level: 1 })).toBeVisible();

  await page.goto('./#/players');
  await page.reload();
  await expect(playersTable(page).getByRole('link', { name: 'Anna' })).toBeVisible();
  await expect(playersTable(page).getByRole('link', { name: 'Ana', exact: true })).toHaveCount(0);

  await nav(page).getByRole('link', { name: 'Tournaments' }).click();
  await page.getByRole('link', { name: 'Pauper Cup' }).click();
  await page.getByRole('tab', { name: 'Standings' }).click();
  await expect(
    page.getByRole('table', { name: 'Standings after round 1' }).getByRole('link', { name: 'Ana' }),
  ).toBeVisible();
});
