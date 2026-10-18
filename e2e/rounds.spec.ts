import { expect, test, type Page } from '@playwright/test';

const PLAYERS = ['Ana', 'Ben', 'Cleo', 'Dan', 'Eve'];

const tables = (page: Page) => page.getByRole('group', { name: /^Table \d+$/ });

/** Clicks `preset` on every row that has result buttons (byes have none). */
async function reportAll(page: Page, preset: string) {
  const rows = tables(page);
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const button = rows.nth(i).getByRole('button', { name: preset, exact: true });
    if ((await button.count()) > 0) {
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
  }
}

/** Text of every table row, to compare a round before and after a reload. */
async function roundText(page: Page): Promise<string[]> {
  return tables(page).allInnerTexts();
}

async function closeRound(page: Page, round: number) {
  await page.getByRole('button', { name: `Close round ${round}` }).click();
  await expect(page.getByRole('button', { name: `Close round ${round}` })).toBeHidden();
}

test('runs a 5-player swiss event from round 1 to the end', async ({ page }) => {
  // Create with "Auto" rounds and register 5 new players.
  await page.goto('./#/tournaments/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Rounds Cup');
  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: 'Pauper' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Rounds Cup', level: 1 })).toBeVisible();

  const newPlayer = page.getByRole('textbox', { name: 'New player' });
  for (const name of PLAYERS) {
    await newPlayer.fill(name);
    await newPlayer.press('Enter');
    await expect(newPlayer).toHaveValue('');
  }
  await expect(page.getByRole('heading', { name: 'Registered (5)' })).toBeVisible();

  // Round 1: one bye; every result with presets, then one correction.
  await page.getByRole('button', { name: 'Pair round 1' }).click();
  await expect(page.getByRole('tab', { name: 'Round 1' })).toHaveAttribute('aria-selected', 'true');
  await expect(tables(page)).toHaveCount(3);
  await expect(tables(page).filter({ hasText: 'Bye' })).toHaveCount(1);
  await expect(page.getByRole('row', { name: /^Swiss rounds/ }).getByRole('cell')).toHaveText('3');

  await reportAll(page, '2-0');
  const corrected = tables(page).first();
  await corrected.getByRole('button', { name: '0-2', exact: true }).click();
  await expect(corrected.getByRole('button', { name: '0-2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(corrected.getByRole('button', { name: '2-0', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await closeRound(page, 1);

  // Round 2: swap two players, then enter every result.
  await page.getByRole('button', { name: 'Pair round 2' }).click();
  await expect(page.getByRole('tab', { name: 'Round 2' })).toHaveAttribute('aria-selected', 'true');
  const before = await roundText(page);

  await page.getByRole('button', { name: 'Swap players' }).click();
  await page.getByRole('combobox', { name: 'First player' }).click();
  await page.getByRole('option').first().click();
  await page.getByRole('combobox', { name: 'Second player' }).click();
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'First player' })).toBeHidden();
  expect(await roundText(page)).not.toEqual(before);

  await reportAll(page, '2-1');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const round2 = await roundText(page);

  // Real IndexedDB: the swapped pairings and the results survive a reload.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Round 2' })).toHaveAttribute('aria-selected', 'true');
  await expect(tables(page)).toHaveCount(3);
  expect(await roundText(page)).toEqual(round2);

  // Round 3, then finish.
  await closeRound(page, 2);
  await page.getByRole('button', { name: 'Pair round 3' }).click();
  await reportAll(page, '1-2');
  await closeRound(page, 3);
  await expect(page.getByRole('button', { name: /^Pair round/ })).toBeHidden();

  await page.getByRole('button', { name: 'Finish tournament' }).click();
  const dialog = page.getByRole('dialog', { name: 'Finish tournament' });
  await dialog.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Finish tournament' })).toBeHidden();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Tournaments' })
    .click();
  const row = page.getByRole('row', { name: /Rounds Cup/ });
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell').nth(3)).toHaveText('Finished');
  await expect(row.getByRole('cell').nth(4)).toHaveText('5');
});
