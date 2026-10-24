import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { load } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows a declared Race that its unusable Tribe cannot confirm', async ({
  page,
}) => {
  await load(page, { Race: 'Hyur', Tribe: 'NotATribe' });
  const race = page.getByTestId('identity').locator('div', {
    has: page.locator('dt', { hasText: /^Race$/ }),
  });
  await expect(race.locator('dd')).toContainText('Hyur');
  await expect(race.locator('dd')).toContainText('declared');
  await expect(race.locator('dd')).not.toContainText('Not stored');
});
const raceRow = (page: Page) =>
  page
    .getByTestId('identity')
    .locator('div', { has: page.locator('dt', { hasText: /^Race$/ }) })
    .locator('dd');
test('shows the canonical race plainly when the Tribe confirms it', async ({
  page,
}) => {
  await load(page, { Race: 'Hyur', Tribe: 'Midlander' });
  await expect(raceRow(page)).toHaveText('Hyur');
});
test('does not invent a Race that was not stored or cannot be read', async ({
  page,
}) => {
  await load(page, { Tribe: 'NotATribe' });
  await expect(raceRow(page)).toHaveText('Not stored');
  await load(page, { Race: 'NotARace', Tribe: 'NotATribe' }, 'second.chara');
  await expect(raceRow(page)).toHaveText(/^(Unsupported|Invalid)$/);
});
