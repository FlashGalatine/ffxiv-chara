import { expect, test } from './fixtures.js';
import {
  activeId,
  answerLookup,
  equipmentBody,
  holdLookup,
  load,
  resolveButton,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('keyboard focus', () => {
  test('moves to Cancel when a lookup starts and back to Resolve when it finishes', async ({
    page,
  }) => {
    const release = await holdLookup(page);
    await load(page, { Tribe: 'Midlander', ...equipmentBody });
    await expect(page.getByTestId('identity')).toContainText('Hyur');
    await expect(page.locator('#resolve-equipment')).toBeEnabled();
    await page.locator('#resolve-equipment').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#cancel-lookup')).toBeFocused();
    release();
    await expect(page.getByTestId('lookup-evidence')).toBeVisible();
    await expect(page.locator('#resolve-equipment')).toBeFocused();
  });

  test('returns to Resolve when a lookup is cancelled from the keyboard', async ({
    page,
  }) => {
    await holdLookup(page);
    await load(page, { Tribe: 'Midlander', ...equipmentBody });
    await expect(page.getByTestId('identity')).toContainText('Hyur');
    await expect(page.locator('#resolve-equipment')).toBeEnabled();
    await page.locator('#resolve-equipment').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#cancel-lookup')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.lookup-status')).toContainText(
      'Lookup cancelled.',
    );
    await expect(page.locator('#resolve-equipment')).toBeFocused();
  });

  test('stays on the example, Clear and file buttons that were activated', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Brio', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('identity')).toContainText('Au Ra');
    expect(await activeId(page)).toBe('example-brio');
    await page.locator('#clear-file').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('identity')).toHaveCount(0);
    expect(await activeId(page)).toBe('choose-file');
  });

  test('stays in the candidate pager after a page is shown', async ({
    page,
  }) => {
    await answerLookup(page, 25);
    await load(page, { Tribe: 'Midlander', ...equipmentBody });
    await expect(page.getByTestId('identity')).toContainText('Hyur');
    await resolveButton(page).click();
    await page.getByText('25 candidates', { exact: true }).click();
    const next = page.getByRole('button', { name: 'Show next 10 candidates' });
    await next.click();
    await expect(page.locator('.candidate-list li').first()).toContainText(
      'Candidate 11',
    );
    await expect(next).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.candidate-list li').first()).toContainText(
      'Candidate 21',
    );
    await expect(
      page.getByRole('button', { name: 'Show previous 10 candidates' }),
    ).toBeFocused();
  });

  test('stays in the stored-values pager after a page is shown', async ({
    page,
  }) => {
    await load(page, {
      HairTone: 0,
      ...Object.fromEntries(
        Array.from({ length: 250 }, (_, i) => [`extra${i}`, 'x']),
      ),
    });
    await expect(page.getByTestId('identity')).toBeVisible();
    await page.getByText('Stored values', { exact: true }).click();
    await page.getByRole('button', { name: 'Show next 200 fields' }).click();
    await expect(
      page.getByRole('button', { name: 'Show previous 200 fields' }),
    ).toBeFocused();
  });
  test('stays on a disclosure summary when the page re-renders', async ({
    page,
  }) => {
    await load(page, { HairTone: 0, Outer: { Inner: 1 } });
    await expect(page.getByTestId('identity')).toBeVisible();
    await expect(page.locator('#resolve-equipment')).toBeEnabled();
    const summary = page.locator('#stored-details > summary');
    await summary.focus();
    await load(page, {}, 'replacement.pose');
    await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
    await expect(summary).toBeFocused();
  });
});
