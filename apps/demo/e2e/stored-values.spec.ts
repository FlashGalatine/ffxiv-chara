import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { load } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('stored values across re-renders', () => {
  const disclosure = (page: Page, title: string) =>
    page.locator('details', {
      has: page.locator(':scope > summary', { hasText: title }),
    });
  test('keep nested disclosures open when a rejected file re-renders the page', async ({
    page,
  }) => {
    await load(page, { HairTone: 0, Outer: { Inner: { deep: 1 } } });
    await expect(page.getByTestId('identity')).toBeVisible();
    await page.getByText('Stored values', { exact: true }).click();
    const outer = disclosure(page, 'Outer — Object');
    await outer.locator(':scope > summary').click();
    const inner = disclosure(page, 'Inner — Object');
    await inner.locator(':scope > summary').click();
    await expect(inner).toContainText('deep');
    await load(page, {}, 'replacement.pose');
    await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
    await expect(outer).toHaveAttribute('open', '');
    await expect(inner).toHaveAttribute('open', '');
    await expect(inner).toContainText('deep');
  });
  test('keep the page of fields that was being read when the page re-renders', async ({
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
    await expect(page.getByTestId('stored-values')).toContainText(
      'Fields 201–251 of 251',
    );
    await load(page, {}, 'replacement.pose');
    await expect(page.getByRole('alert')).toContainText('FILE_EXTENSION');
    await expect(page.getByTestId('stored-values')).toContainText(
      'Fields 201–251 of 251',
    );
  });
  test('start closed on the first page for a different file', async ({
    page,
  }) => {
    const many = Object.fromEntries(
      Array.from({ length: 250 }, (_, i) => [`extra${i}`, 'x']),
    );
    await load(page, { HairTone: 0, ...many });
    await expect(page.getByTestId('identity')).toBeVisible();
    await page.getByText('Stored values', { exact: true }).click();
    await page.getByRole('button', { name: 'Show next 200 fields' }).click();
    await expect(page.getByTestId('stored-values')).toContainText(
      'Fields 201–251 of 251',
    );
    await load(page, { HairTone: 0, ...many, other: 'y' }, 'second.chara');
    await expect(page.locator('#stored-details')).not.toHaveAttribute(
      'open',
      '',
    );
    await page.getByText('Stored values', { exact: true }).click();
    await expect(page.getByTestId('stored-values')).toContainText(
      'Fields 1–200 of 252',
    );
  });
});
