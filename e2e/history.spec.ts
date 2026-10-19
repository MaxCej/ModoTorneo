import { expect, test, type Page } from '@playwright/test';

const PLAYERS = ['Ana', 'Ben', 'Cleo', 'Dan'];

const tables = (page: Page) => page.getByRole('group', { name: /^Table \d+$/ });
const historyRows = (page: Page) =>
  page.getByRole('table', { name: 'History' }).locator('tbody tr');

/** Clicks `preset` on the match at `index` of the open round. */
async function report(page: Page, index: number, preset: string) {
  const button = tables(page).nth(index).getByRole('button', { name: preset, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

test('rolls back a closed round and redoes the pairings of the open one', async ({ page }) => {
  await page.goto('./#/tournaments/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('History Cup');
  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: 'Modern' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'History Cup', level: 1 })).toBeVisible();

  const newPlayer = page.getByRole('textbox', { name: 'New player' });
  for (const name of PLAYERS) {
    await newPlayer.fill(name);
    await newPlayer.press('Enter');
    await expect(newPlayer).toHaveValue('');
  }
  await expect(page.getByRole('heading', { name: 'Registered (4)' })).toBeVisible();

  // Round 1: pair, play, close.
  await page.getByRole('button', { name: 'Pair round 1' }).click();
  await expect(tables(page)).toHaveCount(2);
  await report(page, 0, '2-0');
  await report(page, 1, '2-0');
  await page.getByRole('button', { name: 'Close round 1' }).click();
  await expect(page.getByRole('button', { name: 'Close round 1' })).toBeHidden();

  // History: roll back to the event before "Round 1 closed".
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(historyRows(page).first()).toContainText('Round 1 closed');
  const target = historyRows(page).nth(1);
  const seq = (await target.locator('td').first().innerText()).trim();
  await target.getByRole('button', { name: 'Roll back to here' }).click();
  const modal = page.getByRole('dialog', { name: `Roll back to ${seq}` });
  await expect(modal.getByText('1 round closed')).toBeVisible();
  await expect(
    modal.getByText('After the rollback the tournament is running with round 1 open.'),
  ).toBeVisible();
  await modal.getByRole('button', { name: 'Roll back', exact: true }).click();

  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(historyRows(page).first()).toContainText(`Rolled back to ${seq}`);
  await expect(historyRows(page).nth(1)).toContainText('Undone');
  await expect(page.getByRole('button', { name: 'Close round 1' })).toBeVisible();

  // Round 1 is open again: change one result and close it again.
  await page.getByRole('tab', { name: 'Round 1' }).click();
  await report(page, 0, '1-2');
  await page.getByRole('button', { name: 'Close round 1' }).click();
  await expect(page.getByRole('button', { name: 'Close round 1' })).toBeHidden();

  // Round 2: pair, report one result, then redo the pairings.
  await page.getByRole('button', { name: 'Pair round 2' }).click();
  await expect(page.getByRole('tab', { name: 'Round 2' })).toHaveAttribute('aria-selected', 'true');
  await report(page, 0, '2-1');
  await expect(page.getByText('1 of 2 results')).toBeVisible();

  await page.getByRole('button', { name: 'Redo pairings' }).click();
  const redo = page.getByRole('dialog', { name: 'Redo pairings for round 2?' });
  await expect(redo.getByText('This undoes 1 result and 0 swaps of this round.')).toBeVisible();
  await redo.getByRole('button', { name: 'Redo', exact: true }).click();

  await expect(page.getByRole('tab', { name: 'Round 2' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('0 of 2 results')).toBeVisible();
  await expect(tables(page).getByRole('button', { pressed: true })).toHaveCount(0);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'History' }).click();
  await expect(historyRows(page).first()).toContainText('Round 2 paired');
  const rows = await historyRows(page).allInnerTexts();

  // Real IndexedDB: the same History rows after a reload.
  await page.reload();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(historyRows(page)).toHaveCount(rows.length);
  expect(await historyRows(page).allInnerTexts()).toEqual(rows);
});
