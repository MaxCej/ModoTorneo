import { expect, test, type Page } from '@playwright/test';

const PLAYERS = ['Ana', 'Ben', 'Cleo', 'Dan', 'Eva', 'Fede', 'Gus', 'Hana'];

const tables = (page: Page) => page.getByRole('group', { name: /^Table \d+$/ });
const placings = (page: Page) =>
  page.getByRole('table', { name: 'Top cut placings' }).locator('tbody tr td:first-child');

/** Clicks `presets[i]` on the match at table `i + 1` of the open round. */
async function report(page: Page, presets: string[]) {
  const rows = tables(page);
  await expect(rows).toHaveCount(presets.length);
  for (const [i, preset] of presets.entries()) {
    const button = rows.nth(i).getByRole('button', { name: preset, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
}

async function closeRound(page: Page, round: number) {
  await page.getByRole('button', { name: `Close round ${round}` }).click();
  await expect(page.getByRole('button', { name: `Close round ${round}` })).toBeHidden();
}

test('plays a best of five Top 4 after three swiss rounds', async ({ page }) => {
  await page.goto('./#/tournaments/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Top Cut Cup');
  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: 'Modern' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Top Cut Cup', level: 1 })).toBeVisible();

  const newPlayer = page.getByRole('textbox', { name: 'New player' });
  for (const name of PLAYERS) {
    await newPlayer.fill(name);
    await newPlayer.press('Enter');
    await expect(newPlayer).toHaveValue('');
  }
  await expect(page.getByRole('heading', { name: 'Registered (8)' })).toBeVisible();

  // Three swiss rounds (auto for 8 players), every match 2-0.
  for (const round of [1, 2, 3]) {
    await page.getByRole('button', { name: `Pair round ${round}` }).click();
    await expect(page.getByRole('tab', { name: `Round ${round}` })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await report(page, ['2-0', '2-0', '2-0', '2-0']);
    await closeRound(page, round);
  }
  await expect(page.getByRole('button', { name: 'Pair round 4' })).toBeHidden();

  // Start the top cut: Top 4 is preselected for 8 players; pick best of five.
  await page.getByRole('button', { name: 'Start top cut' }).click();
  const modal = page.getByRole('dialog', { name: 'Start top cut' });
  await expect(modal.getByRole('combobox', { name: 'Size' })).toHaveValue('Top 4');
  await modal.getByText('Best of 5').click();
  await modal.getByRole('button', { name: 'Start top cut' }).click();

  // Semifinals.
  await expect(page.getByRole('tab', { name: 'Semifinals' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(tables(page).first().getByRole('button', { name: '1-1-1' })).toHaveCount(0);
  await report(page, ['3-0', '3-1']);
  await closeRound(page, 4);

  // Final.
  await page.getByRole('button', { name: 'Pair round 5' }).click();
  await expect(page.getByRole('tab', { name: 'Final', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await report(page, ['3-2']);
  await closeRound(page, 5);
  await expect(page.getByRole('button', { name: 'Pair round 6' })).toBeHidden();

  // Placings.
  await page.getByRole('tab', { name: 'Top cut', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Top 4 · Best of 5' })).toBeVisible();
  await expect(placings(page)).toHaveText(['1st', '2nd', '3rd–4th', '3rd–4th']);
  const rows = await page
    .getByRole('table', { name: 'Top cut placings' })
    .locator('tbody tr')
    .allInnerTexts();

  // Finish, then the same placings after a reload (real IndexedDB).
  await page.getByRole('button', { name: 'Finish tournament' }).click();
  await page
    .getByRole('dialog', { name: 'Finish tournament' })
    .getByRole('button', { name: 'Finish', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Finish tournament' })).toBeHidden();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('tab', { name: 'Top cut', exact: true }).click();
  await expect(placings(page)).toHaveText(['1st', '2nd', '3rd–4th', '3rd–4th']);
  expect(
    await page.getByRole('table', { name: 'Top cut placings' }).locator('tbody tr').allInnerTexts(),
  ).toEqual(rows);
});
