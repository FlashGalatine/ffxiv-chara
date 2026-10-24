import { expect, test } from './fixtures.js';
import { expectApproved, load } from './helpers.js';

const V = '0123456789abcdef';
const S = `exdschema@2:rev:${'a'.repeat(40)}`;
const button = 'Resolve equipment and dye names';
test('replacement discards a pending dye result and requires a fresh lookup', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  let finished = false;
  await page.goto('/');
  await page.route('https://v2.xivapi.com/**', async (route) => {
    if (route.request().url().includes('/version')) {
      await route.fulfill({
        json: { versions: [{ key: V, names: ['latest'] }] },
      });
      return;
    }
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({
        json: {
          version: V,
          schema: S,
          rows: [{ row_id: 3, fields: { 'Name@lang(en)': 'OLD_NAME' } }],
        },
      })
      .catch(() => {});
    finished = true;
  });
  await load(page, { Body: { DyeId: 3 } });
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await load(page, { Body: { DyeId: 10 } }, 'replacement.chara');
  await expect(page.getByRole('row', { name: /Body/ })).toContainText(
    'Name not looked up (10)',
  );
  release?.();
  await expect.poll(() => finished).toBe(true);
  await expect(page.getByRole('row', { name: /Body/ })).toContainText(
    'Name not looked up (10)',
  );
  await expect(page.locator('body')).not.toContainText('OLD_NAME');
});
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('keeps names local until explicit lookup, batches IDs and caches repeated lookups', async ({
  page,
  traffic,
}) => {
  const urls: URL[] = [];
  await page.route('https://v2.xivapi.com/**', async (route) => {
    const url = new URL(route.request().url());
    urls.push(url);
    await route.fulfill({
      json: url.pathname.endsWith('/version')
        ? { versions: [{ key: V, names: ['latest'] }] }
        : url.pathname.endsWith('/Stain')
          ? {
              version: V,
              schema: S,
              rows: [
                {
                  row_id: 3,
                  fields: { 'Name@lang(en)': '<b>Synthetic dye</b>' },
                },
                { row_id: 126, fields: { 'Name@lang(en)': '' } },
              ],
            }
          : { version: V, schema: S, results: [] },
    });
  });
  const file = {
    Author: 'PRIVATE_AUTHOR',
    Nickname: 'PRIVATE_NAME',
    HairTone: 77,
    Body: { ModelBase: 361, ModelVariant: 5, DyeId: 3, DyeId2: 0 },
    Hands: { ModelBase: 361, ModelVariant: 5, DyeId: 126, DyeId2: 65535 },
  };
  await load(page, file);
  const body = page.getByRole('row', { name: /Body/ });
  await expect(body).toContainText('Name not looked up (3)');
  await expect(body).toContainText('No dye (0)');
  expect(urls).toEqual([]);
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(body).toContainText('<b>Synthetic dye</b> (3)');
  await expect(page.getByRole('row', { name: /Hands/ })).toContainText(
    'Blank name (126)',
  );
  await expect(page.getByRole('row', { name: /Hands/ })).toContainText(
    'Name not found (65535)',
  );
  await expect(page.getByTestId('equipment').locator('b')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: button, exact: true }),
  ).toBeEnabled();
  const stains = () => urls.filter((url) => url.pathname.endsWith('/Stain'));
  expect(stains()).toHaveLength(1);
  expect(stains()[0]?.searchParams.get('rows')).toBe('3,126,65535');
  await traffic.settle();
  expect(traffic.toXivapi().length).toBeGreaterThan(1);
  for (const request of traffic.toXivapi()) expectApproved(request);
  expect(urls.map(String).join(' ')).not.toMatch(
    /PRIVATE_|HairTone|Nickname|Author/,
  );
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(
    page.getByRole('button', { name: button, exact: true }),
  ).toBeEnabled();
  expect(stains()).toHaveLength(1);
  await page.getByRole('button', { name: 'Clear file', exact: true }).click();
  await load(page, file);
  await expect(page.getByRole('row', { name: /Body/ })).toContainText(
    'Name not looked up (3)',
  );
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByRole('row', { name: /Body/ })).toContainText(
    '<b>Synthetic dye</b> (3)',
  );
  expect(stains()).toHaveLength(1);
});

test('keeps raw IDs usable when dye lookup fails', async ({ page }) => {
  await page.route('https://v2.xivapi.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/Stain'))
      await route.fulfill({
        status: 503,
        headers: { 'Retry-After': '60' },
        body: 'Unavailable',
      });
    else
      await route.fulfill({
        json: path.endsWith('/version')
          ? { versions: [{ key: V, names: ['latest'] }] }
          : { version: V, schema: S, results: [] },
      });
  });
  await load(page, { Body: { ModelBase: 361, ModelVariant: 5, DyeId: 3 } });
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByRole('row', { name: /Body/ })).toContainText(
    'Name unavailable (3)',
  );
  await expect(
    page.getByRole('button', { name: button, exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId('identity')).toBeVisible();
});
