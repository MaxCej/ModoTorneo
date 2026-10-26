import { expect, test, type Page } from '@playwright/test';

const DECKS: Record<string, string> = {
  Ana: 'Burn',
  Ben: 'Izzet Prowess',
  Cleo: 'Amulet Titan',
  Gus: 'Elves',
};

const MOXFIELD = [
  '4 Lightning Bolt (2X2) 117',
  '4 Goblin Guide (ZEN) 126 *F*',
  '18 Mountain (UNF) 238',
  'not a card',
  '',
  'SIDEBOARD:',
  '2 Smash to Smithereens (ALA) 114',
].join('\n');

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

const deckDialog = (page: Page, name: string) =>
  page.getByRole('dialog', { name: `Deck · ${name}` });

async function openDeck(page: Page, name: string) {
  await page.getByRole('button', { name: `Deck for ${name}` }).click();
  await expect(deckDialog(page, name)).toBeVisible();
  return deckDialog(page, name);
}

async function saveDeck(page: Page, name: string) {
  await deckDialog(page, name).getByRole('button', { name: 'Save' }).click();
  await expect(deckDialog(page, name)).toBeHidden();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

test('records archetypes and a decklist, and shows them across the app', async ({ page }) => {
  // Modern: three new registry players and one guest, each with an archetype.
  await createTournament(page, 'Modern Decks', 'Modern');
  for (const name of ['Ana', 'Ben', 'Cleo']) {
    await addName(page, 'New player', name);
  }
  await addName(page, 'Add guest', 'Gus');
  await expect(page.getByRole('heading', { name: 'Registered (4)' })).toBeVisible();

  for (const [name, archetype] of Object.entries(DECKS)) {
    const dialog = await openDeck(page, name);
    await dialog.getByRole('combobox', { name: 'Archetype' }).fill(archetype);
    if (name === 'Ana') {
      await dialog.getByRole('textbox', { name: 'Decklist' }).fill(MOXFIELD);
      await expect(dialog.getByText('Main deck (26)')).toBeVisible();
      await expect(dialog.getByText('Sideboard (2)')).toBeVisible();
      await expect(dialog.getByText('1 line was not read:')).toBeVisible();
      await expect(dialog.getByText('Line 4: not a card')).toBeVisible();
    }
    await saveDeck(page, name);
  }
  const registered = page.getByRole('heading', { name: 'Registered (4)' }).locator('..');
  for (const archetype of Object.values(DECKS)) {
    await expect(registered.getByText(archetype, { exact: true })).toBeVisible();
  }

  // Round 1: archetypes under the names in the round tab.
  await page.getByRole('button', { name: 'Pair round 1' }).click();
  const tables = page.getByRole('group', { name: /^Table \d+$/ });
  await expect(tables).toHaveCount(2);
  for (const archetype of Object.values(DECKS)) {
    await expect(tables.getByText(archetype, { exact: true })).toBeVisible();
  }
  for (let i = 0; i < 2; i++) {
    const button = tables.nth(i).getByRole('button', { name: '2-0', exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Close round 1' }).click();
  await expect(page.getByRole('button', { name: 'Close round 1' })).toBeHidden();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // Standings: a Deck column with every archetype.
  await page.getByRole('tab', { name: 'Standings' }).click();
  const standings = page.getByRole('table', { name: 'Standings after round 1' });
  await expect(standings.getByRole('columnheader', { name: 'Deck' })).toBeVisible();
  for (const [name, archetype] of Object.entries(DECKS)) {
    const row = standings.locator('tbody tr', { hasText: name });
    await expect(row.locator('td:nth-child(3)')).toHaveText(archetype);
  }
  const firstUrl = page.url();

  // A second Modern tournament suggests the first one's archetypes.
  await createTournament(page, 'Modern Again', 'Modern');
  await page.getByRole('button', { name: 'Add Ana' }).click();
  const again = await openDeck(page, 'Ana');
  // Suggestions load when the modal opens; typing again shows them once loaded.
  const archetype = again.getByRole('combobox', { name: 'Archetype' });
  await expect(async () => {
    await archetype.fill('');
    await archetype.fill('i');
    await expect(page.getByRole('option', { name: 'Izzet Prowess' })).toBeVisible({
      timeout: 500,
    });
  }).toPass();
  await expect(page.getByRole('option', { name: 'Amulet Titan' })).toBeVisible();
  await archetype.fill('izzet prowess');
  await saveDeck(page, 'Ana');
  await expect(
    page.getByRole('heading', { name: 'Registered (1)' }).locator('..').getByText('Izzet Prowess'),
  ).toBeVisible();

  // Reload the first tournament: the stored list comes back in the modal.
  await page.goto(firstUrl);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Modern Decks', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Players' }).click();
  const stored = await openDeck(page, 'Ana');
  await expect(stored.getByRole('combobox', { name: 'Archetype' })).toHaveValue('Burn');
  await expect(stored.getByRole('textbox', { name: 'Decklist' })).toHaveValue(
    '4 Lightning Bolt\n4 Goblin Guide\n18 Mountain\n\nSideboard\n2 Smash to Smithereens',
  );
  await page.keyboard.press('Escape');
  await expect(stored).toBeHidden();

  // The profile history shows the archetype of each tournament.
  await page.getByRole('tab', { name: 'Standings' }).click();
  await page
    .getByRole('table', { name: 'Standings after round 1' })
    .getByRole('link', { name: 'Ana' })
    .click();
  await expect(page.getByRole('heading', { name: 'Ana', level: 1 })).toBeVisible();
  const history = page.getByRole('table', { name: 'Tournament history' });
  await expect(history.getByRole('columnheader', { name: 'Deck' })).toBeVisible();
  await expect(history.locator('tbody tr', { hasText: 'Modern Decks' })).toContainText('Burn');
  await expect(history.locator('tbody tr', { hasText: 'Modern Again' })).toContainText(
    'Izzet Prowess',
  );
});
