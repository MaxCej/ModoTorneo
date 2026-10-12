import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const FIXTURE = fileURLToPath(
  new URL('../src/domain/fixtures/top4-8players.json', import.meta.url),
);

test('imports, exports, keeps across reloads and deletes a tournament', async ({ page }) => {
  await page.goto('./#/data');
  await expect(page.getByText('No tournaments stored yet.')).toBeVisible();

  // The "Import file" button opens this hidden input.
  await page.locator('input[type="file"]').setInputFiles(FIXTURE);
  const row = page.getByRole('row', { name: /Friday Night Magic/ });
  await expect(row).toBeVisible();
  await expect(page.getByText('Added: 1')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('modotorneo-friday-night-magic-2026-10-11.json');
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported).toEqual(JSON.parse(await readFile(FIXTURE, 'utf8')));

  // Real IndexedDB: the row survives a reload.
  await page.reload();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete tournament' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No tournaments stored yet.')).toBeVisible();
  await expect(dialog).toBeHidden();
});
