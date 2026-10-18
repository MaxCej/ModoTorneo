import { expect, test } from '@playwright/test';

test('home page shows the tournament list inside the app shell', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Tournaments' })).toBeVisible();
  await expect(page.getByRole('banner').getByText('ModoTorneo')).toBeVisible();
});

test('unknown route shows the not-found page', async ({ page }) => {
  await page.goto('./#/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
