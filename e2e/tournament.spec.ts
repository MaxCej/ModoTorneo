import { expect, test, type Page } from '@playwright/test';

async function addName(page: Page, label: 'New player' | 'Add guest', name: string) {
  const input = page.getByRole('textbox', { name: label });
  await input.fill(name);
  await input.press('Enter');
  await expect(input).toHaveValue('');
}

const registered = (page: Page) =>
  page
    .getByRole('heading', { name: /^Registered \(\d+\)$/ })
    .locator('..')
    .getByRole('listitem');

const roundsText = (page: Page) =>
  page.getByRole('row', { name: /^Swiss rounds/ }).getByRole('cell');

test('creates a tournament, registers players and keeps them across reloads', async ({ page }) => {
  // Create with "Auto" rounds (the default).
  await page.goto('./');
  await page.getByRole('link', { name: 'New tournament' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('E2E Cup');
  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: 'Modern' }).click();
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(/#\/tournaments\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'E2E Cup', level: 1 })).toBeVisible();
  await expect(roundsText(page)).toHaveText('Auto (register at least 2 players)');

  // Two new players and one guest.
  await addName(page, 'New player', 'Alice');
  await addName(page, 'New player', 'Bruno');
  await addName(page, 'Add guest', 'Visitor');
  await expect(page.getByRole('heading', { name: 'Registered (3)' })).toBeVisible();
  await expect(registered(page).filter({ hasText: 'Visitor' })).toContainText('Guest');
  await expect(roundsText(page)).toHaveText('Auto (2 for 3 players)');

  // Remove one: a registry player goes back to the left list.
  await page.getByRole('button', { name: 'Remove Bruno' }).click();
  await expect(page.getByRole('heading', { name: 'Registered (2)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Bruno' })).toBeVisible();
  await expect(roundsText(page)).toHaveText('Auto (1 for 2 players)');

  // Edit the name inline.
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('E2E Cup Renamed');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Cup Renamed', level: 1 })).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // Real IndexedDB: everything survives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'E2E Cup Renamed', level: 1 })).toBeVisible();
  await expect(registered(page)).toHaveCount(2);
  await expect(registered(page).nth(0)).toContainText('Alice');
  await expect(registered(page).nth(1)).toContainText('Visitor');

  // The list shows the renamed tournament with 2 players.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', {
      name: 'Tournaments',
    })
    .click();
  const row = page.getByRole('row', { name: /E2E Cup Renamed/ });
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell').nth(4)).toHaveText('2');
});
