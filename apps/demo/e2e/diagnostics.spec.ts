import { expect, test } from './fixtures.js';
import { load } from './helpers.js';

// The diagnostics list joins the issues of the inspection, the colors and the lookup, and draws at
// most 64 of them. The inspection and the colors each keep up to 64 issues of their own, so the
// joined list can be longer than the page shows.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** A document with this many unknown fields (one issue each) and one color the library clamps. */
const withIssues = (unknownFields: number) => ({
  Tribe: 'Midlander',
  Gender: 'Masculine',
  HairTone: 0,
  IsExtendedAppearanceValid: true,
  HairColor: '5, -5, 9',
  ...Object.fromEntries(
    Array.from({ length: unknownFields }, (_, i) => [`Unknown${i}`, i]),
  ),
});

const entries = (page: import('@playwright/test').Page) =>
  page.locator('#diagnostics-list .detail-body > p.caption');
const omitted = (page: import('@playwright/test').Page) =>
  page.getByText('Additional diagnostics omitted.');

test('lists the issues of a lookup that could not finish', async ({ page }) => {
  await page.route('https://v2.xivapi.com/**', (route) =>
    route.fulfill({ status: 500, body: 'no' }),
  );
  await load(page, {
    Tribe: 'Midlander',
    HairTone: 0,
    Body: { ModelBase: 361, ModelVariant: 5 },
  });
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await page.getByRole('button', { name: 'Resolve equipment' }).click();
  await expect(page.getByTestId('equipment')).toContainText('Unavailable');
  // The failure is one of the diagnostics, next to those of the file itself.
  await expect(
    page.locator('#diagnostics-list .detail-body > p.caption', {
      hasText: 'UPSTREAM_UNAVAILABLE',
    }),
  ).not.toHaveCount(0);
});

test.describe('the diagnostics cap', () => {
  test('lists every issue, without a note, when there are exactly 64', async ({
    page,
  }) => {
    // 63 unknown fields and the clamped color.
    await load(page, withIssues(63));
    await expect(page.getByTestId('identity')).toContainText('Hyur');
    await expect(page.getByTestId('swatches')).not.toContainText('Loading');
    await expect(page.locator('#diagnostics-list > summary')).toHaveText(
      '64 diagnostics',
    );
    await expect(entries(page)).toHaveCount(64);
    await expect(entries(page).last()).toContainText('EXTENDED_CLAMPED');
    await expect(omitted(page)).toHaveCount(0);
  });

  test('lists 64 of 65 issues and says that more were omitted', async ({
    page,
  }) => {
    // 64 unknown fields fill the inspection's own list; the clamped color is the 65th.
    await load(page, withIssues(64));
    await expect(page.getByTestId('identity')).toContainText('Hyur');
    await expect(page.getByTestId('swatches')).not.toContainText('Loading');
    await expect(page.locator('#diagnostics-list > summary')).toHaveText(
      '65 diagnostics',
    );
    // 64 issues and the note are paragraphs of the same list.
    await expect(entries(page)).toHaveCount(65);
    await expect(entries(page).last()).toHaveText(
      'Additional diagnostics omitted.',
    );
    await expect(omitted(page)).toHaveCount(1);
    // The 65th issue, the color, is the one that is not listed.
    await expect(
      page.locator('#diagnostics-list').getByText('EXTENDED_CLAMPED'),
    ).toHaveCount(0);
  });
});
