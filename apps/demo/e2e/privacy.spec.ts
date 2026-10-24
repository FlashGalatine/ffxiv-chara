import { expect, PRIVATE, test } from './fixtures.js';
import {
  APPROVED_PATHS,
  CANARY_FILE,
  canaryDocument,
  expectApproved,
  load,
  mockXivapi,
  resolveButton,
  V,
} from './helpers.js';

// SEC-03 (docs/security/THREAT_MODEL.md): requests are watched from before the page loads, a file
// full of canaries goes through every step, and nothing may carry a canary anywhere it could leave.
// The fixture in fixtures.ts fails any test in which a canary reaches a request, a header, a body,
// the console, a page error, a dialog, a navigation, a popup or a download.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const APP_ASSET = /^\/(assets\/[\w.-]+)?$/;
test('requests only the page and its own assets from load until the user asks, whatever the file holds', async ({
  page,
  traffic,
}) => {
  // The page has already loaded: the recorder was attached before it navigated.
  expect(traffic.requests.length).toBeGreaterThan(0);
  expect(traffic.offOrigin()).toEqual([]);
  await load(page, canaryDocument(), CANARY_FILE);
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(page.getByTestId('swatches')).not.toContainText('Loading');
  await page.getByText('Stored values', { exact: true }).click();
  await expect(page.getByTestId('stored-values')).toContainText('CANARY_KEY');
  await traffic.settle();
  for (const request of traffic.requests) {
    const url = new URL(request.url);
    expect(request.origin).toBe(traffic.appOrigin);
    expect(request.method).toBe('GET');
    expect(request.postData).toBeNull();
    expect(url.pathname).toMatch(APP_ASSET);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  }
  expect(traffic.navigations).toEqual([`${traffic.appOrigin}/`]);
  expect(page.url()).toBe(`${traffic.appOrigin}/`);
  expect(await traffic.leaks(PRIVATE)).toEqual([]);
});

for (const [button, race, file] of [
  ['Anamnesis', 'Hyur', 'anamnesis'],
  ['Ktisis', 'Lalafell', 'ktisis'],
  ['Brio', 'Au Ra', 'brio'],
] as const)
  test(`requests only the synthetic ${button} file when that example is chosen`, async ({
    page,
    traffic,
  }) => {
    await traffic.reset();
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.getByTestId('identity')).toContainText(race);
    await expect(page.getByTestId('swatches')).not.toContainText('Loading');
    await traffic.settle();
    expect(traffic.offOrigin()).toEqual([]);
    for (const request of traffic.requests) {
      const url = new URL(request.url);
      expect(request.method).toBe('GET');
      expect(request.postData).toBeNull();
      expect(url.search).toBe('');
      expect(url.hash).toBe('');
    }
    expect(
      traffic.requests
        .map((request) => new URL(request.url).pathname)
        .filter((path) => !APP_ASSET.test(path)),
    ).toEqual([`/examples/${file}.chara`]);
  });

test('sends only approved identifiers and controls to the reviewed origin, and nothing else', async ({
  page,
  traffic,
}) => {
  await mockXivapi(page, { iconId: 4242 });
  await load(page, canaryDocument(), CANARY_FILE);
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(resolveButton(page)).toBeEnabled();
  expect(traffic.toXivapi()).toEqual([]);
  await resolveButton(page).click();
  await expect(page.getByTestId('lookup-evidence')).toBeVisible();
  await expect(page.locator('.item-icon img')).toHaveCount(2);
  await traffic.settle();
  const requests = traffic.toXivapi();
  expect(requests.length).toBeGreaterThan(3);
  const seen = new Set<string>();
  for (const request of requests) {
    const url = new URL(request.url);
    seen.add(url.pathname);
    expectApproved(request);
    switch (url.pathname) {
      case '/api/version':
        expect(url.search).toBe('');
        break;
      case '/api/sheet/Stain':
        expect(url.searchParams.get('rows')).toBe('77,88');
        expect(url.searchParams.get('fields')).toBe('Name@lang(en)');
        expect(url.searchParams.get('language')).toBe('en');
        expect(url.searchParams.get('version')).toBe(V);
        break;
      case '/api/sheet/Glasses':
        expect(url.searchParams.get('rows')).toBe('12');
        expect(url.searchParams.get('version')).toBe(V);
        break;
      case '/api/search':
        expect(url.searchParams.get('query')).toBe(
          '+((+EquipSlotCategory.Body=1 +ModelMain=328041))',
        );
        expect(url.searchParams.get('version')).toBe(V);
        break;
      case '/api/asset':
        expect(url.searchParams.get('format')).toBe('png');
        expect(url.searchParams.get('version')).toBe(V);
        expect(
          ['004242', '004243'].map((id) => `ui/icon/004000/${id}_hr1.tex`),
        ).toContain(url.searchParams.get('path'));
        break;
    }
  }
  expect([...seen].sort()).toEqual([...APPROVED_PATHS].sort());
  const assets = requests.filter((r) => r.url.includes('/api/asset'));
  expect(assets).toHaveLength(2);
  expect(await traffic.leaks(PRIVATE)).toEqual([]);
});

test('keeps character data out of storage, cookies, history, the file system, the address and the console through a lookup with icons', async ({
  page,
  traffic,
}) => {
  await mockXivapi(page, { iconId: 4242 });
  await load(page, canaryDocument(), CANARY_FILE);
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  await expect(resolveButton(page)).toBeEnabled();
  await resolveButton(page).click();
  await expect(page.locator('.item-icon img')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear file' }).click();
  await expect(page.getByTestId('identity')).toHaveCount(0);
  await load(page, canaryDocument(), CANARY_FILE);
  await expect(page.getByTestId('identity')).toContainText('Hyur');
  const state = await page.evaluate(async () => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    databases: (await indexedDB.databases()).map((d) => d.name),
    caches: await caches.keys(),
    workers: (await navigator.serviceWorker.getRegistrations()).length,
    cookie: document.cookie,
    href: location.href,
    name: window.name,
    history: JSON.stringify(history.state),
    opfs: await (async () => {
      const names: string[] = [];
      const root = await navigator.storage.getDirectory();
      for await (const [name] of root.entries()) names.push(name);
      return names;
    })(),
  }));
  expect(state).toEqual({
    local: [],
    session: [],
    databases: [],
    caches: [],
    workers: 0,
    cookie: '',
    href: `${traffic.appOrigin}/`,
    name: '',
    history: 'null',
    opfs: [],
  });
  expect(await page.context().cookies()).toEqual([]);
  expect(JSON.stringify(state)).not.toMatch(PRIVATE);
  expect(await traffic.leaks(PRIVATE)).toEqual([]);
});
