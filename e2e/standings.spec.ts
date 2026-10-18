import { expect, test, type Page } from '@playwright/test';

const PLAYERS = ['Ana', 'Ben', 'Cleo', 'Dan'];

const tables = (page: Page) => page.getByRole('group', { name: /^Table \d+$/ });
const standings = (page: Page, round: number) =>
  page.getByRole('table', { name: `Standings after round ${round}` });
const bodyRows = (page: Page, round: number) => standings(page, round).locator('tbody tr');

/** Clicks `preset` on every match of the open round. */
async function reportAll(page: Page, preset: string) {
  const rows = tables(page);
  await expect(rows).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const button = rows.nth(i).getByRole('button', { name: preset, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
}

async function playRound(page: Page, round: number, preset: string) {
  await page.getByRole('button', { name: `Pair round ${round}` }).click();
  await expect(page.getByRole('tab', { name: `Round ${round}` })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await reportAll(page, preset);
  await page.getByRole('button', { name: `Close round ${round}` }).click();
  await expect(page.getByRole('button', { name: `Close round ${round}` })).toBeHidden();
}

/** The MP column, top to bottom. */
async function matchPoints(page: Page, round: number): Promise<string[]> {
  return bodyRows(page, round).locator('td:nth-child(3)').allInnerTexts();
}

test('shows swiss standings after each closed round', async ({ page }) => {
  await page.goto('./#/tournaments/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Standings Cup');
  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: 'Modern' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Standings Cup', level: 1 })).toBeVisible();

  const newPlayer = page.getByRole('textbox', { name: 'New player' });
  for (const name of PLAYERS) {
    await newPlayer.fill(name);
    await newPlayer.press('Enter');
    await expect(newPlayer).toHaveValue('');
  }
  await expect(page.getByRole('heading', { name: 'Registered (4)' })).toBeVisible();

  // Before round 1 is closed: the empty state.
  await page.getByRole('tab', { name: 'Standings' }).click();
  await expect(page.getByText('Standings appear when round 1 is closed.')).toBeVisible();

  // Round 1: both winners on 3 MP.
  await playRound(page, 1, '2-0');
  await page.getByRole('tab', { name: 'Standings' }).click();
  await expect(bodyRows(page, 1)).toHaveCount(4);
  await expect(bodyRows(page, 1).locator('td:first-child')).toHaveText(['1', '1', '3', '3']);
  expect(await matchPoints(page, 1)).toEqual(['3', '3', '0', '0']);

  // Round 2: the picker follows the last closed round, and round 1 is still one pick away.
  await playRound(page, 2, '2-1');
  await page.getByRole('tab', { name: 'Standings' }).click();
  const picker = page.getByRole('combobox', { name: 'After round' });
  await expect(picker).toHaveValue('Round 2');
  await expect(bodyRows(page, 2)).toHaveCount(4);
  expect(await matchPoints(page, 2)).toEqual(['6', '3', '3', '0']);
  const round2 = await bodyRows(page, 2).allInnerTexts();

  await picker.click();
  await page.getByRole('option', { name: 'Round 1' }).click();
  await expect(picker).toHaveValue('Round 1');
  expect(await matchPoints(page, 1)).toEqual(['3', '3', '0', '0']);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // Real IndexedDB: the same standings after a reload.
  await page.reload();
  await page.getByRole('tab', { name: 'Standings' }).click();
  await expect(picker).toHaveValue('Round 2');
  await expect(bodyRows(page, 2)).toHaveCount(4);
  expect(await bodyRows(page, 2).allInnerTexts()).toEqual(round2);
});
