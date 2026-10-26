import { expect, test, type Page } from '@playwright/test';

const PLAYERS = ['Ana', 'Ben', 'Cleo', 'Dan'];

const clock = (page: Page) => page.getByTestId('timer-clock');

test('runs a round timer with a big timer window that follows it', async ({ page }) => {
  // The clock flows normally until the test fast-forwards it, in every page of the context.
  await page.clock.install({ time: new Date('2026-10-26T18:00:00') });

  await page.goto('./#/tournaments/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Timer Cup');
  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: 'Modern' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Timer Cup', level: 1 })).toBeVisible();

  const newPlayer = page.getByRole('textbox', { name: 'New player' });
  for (const name of PLAYERS) {
    await newPlayer.fill(name);
    await newPlayer.press('Enter');
    await expect(newPlayer).toHaveValue('');
  }

  // No timer before a round is open; pairing does not start it.
  const card = page.getByRole('region', { name: 'Round timer' });
  await expect(card).toBeHidden();
  await page.getByRole('button', { name: 'Pair round 1' }).click();
  await expect(card.getByText('Not started')).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'Minutes' })).toHaveValue('50');

  // Start a 1-minute timer and open the big timer.
  await card.getByRole('textbox', { name: 'Minutes' }).fill('1');
  await card.getByRole('button', { name: 'Start' }).click();
  await expect(clock(page)).toHaveText(/^00:[0-5]\d$|^01:00$/);
  const popupOpened = page.waitForEvent('popup');
  await card.getByRole('button', { name: 'Open big timer' }).click();
  const big = await popupOpened;
  await expect(big).toHaveURL(/#\/tournaments\/[^/]+\/timer$/);
  await expect(big.getByRole('heading', { name: 'Timer Cup' })).toBeVisible();
  await expect(big.getByText('Round 1')).toBeVisible();
  await expect(clock(big)).toHaveText(/^00:[0-5]\d$|^01:00$/);
  await expect(big.getByRole('link', { name: 'Tournaments' })).toHaveCount(0);

  // Pause: both show the same frozen value.
  await card.getByRole('button', { name: 'Pause' }).click();
  await expect(big.getByText('Paused')).toBeVisible();
  const paused = await clock(page).textContent();
  await expect(clock(big)).toHaveText(paused!);

  // Resume and run past zero: "Time" and overtime in both.
  await card.getByRole('button', { name: 'Resume' }).click();
  await expect(big.getByText('Paused')).toBeHidden();
  await page.clock.fastForward('01:05');
  await expect(card.getByText('Time', { exact: true })).toBeVisible();
  await expect(big.getByText('Time', { exact: true })).toBeVisible();
  await expect(clock(page)).toHaveText(/^\+00:\d\d$/);
  await expect(clock(big)).toHaveText(/^\+00:\d\d$/);
  await expect(page.getByText('Round 1: time is up')).toBeVisible();

  // Reload keeps the timer.
  await page.reload();
  await expect(card.getByText('Time', { exact: true })).toBeVisible();

  // Close the round: the card goes away and the big timer waits.
  const tables = page.getByRole('group', { name: /^Table \d+$/ });
  await expect(tables).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const button = tables.nth(i).getByRole('button', { name: '2-0', exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Close round 1' }).click();
  await expect(card).toBeHidden();
  await expect(big.getByText('Waiting for the next round.')).toBeVisible();

  // The next round starts with no timer and remembers the length.
  await page.getByRole('button', { name: 'Pair round 2' }).click();
  await expect(card.getByText('Not started')).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'Minutes' })).toHaveValue('1');
  await expect(big.getByText('Round 2')).toBeVisible();
  await expect(big.getByText('Not started')).toBeVisible();
});
