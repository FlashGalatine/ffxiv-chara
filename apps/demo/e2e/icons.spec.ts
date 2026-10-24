import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.js';
import {
  CANARY_FILE,
  canaryDocument,
  expectApproved,
  load,
  mockXivapi,
  PNG,
  resolveButton,
} from './helpers.js';

// Icons are optional evidence fetched only after Resolve (docs/security/THREAT_MODEL.md): fixed
// route and origin, bounded, blob-backed, and released with the lookup. The loader's own bounds are
// pinned by test/icons.test.ts; this file is the same thing in the real page.

interface BlobLog {
  created: string[];
  revoked: string[];
}
type Blobs = { __blobs: BlobLog };
const blobs = (page: Page) =>
  page.evaluate(() => (window as unknown as Blobs).__blobs);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const log: BlobLog = { created: [], revoked: [] };
    (window as unknown as Blobs).__blobs = log;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = create(object);
      log.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      log.revoked.push(url);
      revoke(url);
    };
  });
  await page.goto('/');
});

async function resolveWithIcons(page: Page) {
  await load(page, canaryDocument(), CANARY_FILE);
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(resolveButton(page)).toBeEnabled();
  await resolveButton(page).click();
}

test('requests icons only after Resolve and shows them as blob-backed images', async ({
  page,
  traffic,
}) => {
  await mockXivapi(page, { iconId: 4242 });
  await load(page, canaryDocument(), CANARY_FILE);
  await expect(resolveButton(page)).toBeEnabled();
  await traffic.settle();
  expect(traffic.toXivapi()).toEqual([]);
  expect(await blobs(page)).toEqual({ created: [], revoked: [] });
  await resolveButton(page).click();
  const images = page.locator('.item-icon img');
  await expect(images).toHaveCount(2);
  await expect
    .poll(() =>
      images.evaluateAll(
        (all) =>
          all.length === 2 &&
          all.every((image) => (image as HTMLImageElement).naturalWidth === 1),
      ),
    )
    .toBe(true);
  await expect(page.locator('.item-icon', { hasText: '—' })).toHaveCount(0);
  for (const image of await images.all()) {
    expect(await image.getAttribute('src')).toMatch(/^blob:/);
    expect(await image.getAttribute('alt')).toBe('');
    expect(await image.getAttribute('referrerpolicy')).toBe('no-referrer');
  }
  await traffic.settle();
  const assets = traffic
    .toXivapi()
    .filter((r) => new URL(r.url).pathname === '/api/asset');
  expect(assets).toHaveLength(2);
  for (const asset of assets) expectApproved(asset);
  expect((await blobs(page)).created).toHaveLength(2);
});

test.describe('object URLs', () => {
  const showIcons = async (page: Page) => {
    await mockXivapi(page, { iconId: 4242 });
    await resolveWithIcons(page);
    await expect(page.locator('.item-icon img')).toHaveCount(2);
    const { created, revoked } = await blobs(page);
    expect(created).toHaveLength(2);
    expect(revoked).toEqual([]);
    return created;
  };
  test('are revoked when the file is cleared', async ({ page }) => {
    const created = await showIcons(page);
    await page.getByRole('button', { name: 'Clear file' }).click();
    await expect(page.getByTestId('identity')).toHaveCount(0);
    expect((await blobs(page)).revoked.sort()).toEqual([...created].sort());
  });
  test('are revoked when another file replaces it', async ({ page }) => {
    const created = await showIcons(page);
    await load(page, { Tribe: 'Xaela' }, 'second.chara');
    await expect(page.getByTestId('identity')).toContainText('Au Ra');
    expect((await blobs(page)).revoked.sort()).toEqual([...created].sort());
    await expect(page.locator('.item-icon img')).toHaveCount(0);
  });
  test('are never made for an icon that arrives after the file was cleared', async ({
    page,
  }) => {
    let arrived: (() => void) | undefined;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockXivapi(page, {
      iconId: 4242,
      asset: async (route: Route) => {
        arrived?.();
        await gate;
        await route
          .fulfill({ body: PNG, contentType: 'image/png' })
          .catch(() => {});
      },
    });
    const requested = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await resolveWithIcons(page);
    await requested;
    await page.getByRole('button', { name: 'Clear file' }).click();
    await expect(page.getByTestId('identity')).toHaveCount(0);
    release();
    await page.waitForTimeout(300);
    // The request was cancelled with the lookup, so no object URL was ever made for it.
    expect(await blobs(page)).toEqual({ created: [], revoked: [] });
    await expect(page.locator('img')).toHaveCount(0);
  });
});

test.describe('hostile icon responses', () => {
  const hostile: [string, (route: Route) => Promise<void>][] = [
    [
      'an SVG',
      (route) =>
        route.fulfill({
          body: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
          contentType: 'image/svg+xml',
        }),
    ],
    [
      'HTML served as a PNG',
      (route) =>
        route.fulfill({
          body: '<script>alert(1)</script>',
          contentType: 'image/png',
        }),
    ],
    [
      'an oversized PNG',
      (route) =>
        route.fulfill({
          body: Buffer.concat([PNG, Buffer.alloc(300 * 1024)]),
          contentType: 'image/png',
        }),
    ],
    [
      'a PNG that is too large in pixels',
      (route) => {
        const big = Buffer.from(PNG);
        big.writeUInt32BE(4096, 16);
        return route.fulfill({ body: big, contentType: 'image/png' });
      },
    ],
    [
      'a redirect to another path',
      (route) =>
        route.fulfill({
          status: 302,
          headers: { location: 'https://v2.xivapi.com/api/other' },
        }),
    ],
    [
      'a server error',
      (route) => route.fulfill({ status: 500, body: 'PRIVATE_SERVER_ERROR' }),
    ],
  ];
  for (const [name, answer] of hostile)
    test(`show no icon for ${name} and leave the equipment usable`, async ({
      page,
      traffic,
    }) => {
      await mockXivapi(page, { iconId: 4242, asset: answer });
      await resolveWithIcons(page);
      await expect(page.getByTestId('lookup-evidence')).toBeVisible();
      await expect(page.getByTestId('equipment')).toContainText('2 candidates');
      await expect
        .poll(async () => {
          await traffic.settle();
          return traffic
            .toXivapi()
            .filter((r) => new URL(r.url).pathname === '/api/asset').length;
        })
        .toBe(2);
      await page.waitForTimeout(200);
      await expect(page.locator('.item-icon img')).toHaveCount(0);
      expect(
        traffic.toXivapi().filter((r) => r.url.includes('/api/other')),
      ).toEqual([]);
      expect((await blobs(page)).created).toEqual([]);
    });
});
