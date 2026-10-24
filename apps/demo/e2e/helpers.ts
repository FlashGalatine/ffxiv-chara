import { expect, type Page, type Route } from '@playwright/test';
import type { Recorded } from './fixtures.js';
export async function load(page: Page, content: unknown, name = 'test.chara') {
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(
      typeof content === 'string' ? content : JSON.stringify(content),
    ),
  });
}

export const V = '0123456789abcdef';
export const S = `exdschema@2:rev:${'a'.repeat(40)}`;
export const item = (id: number, name: string, icon?: number) => ({
  sheet: 'Item',
  row_id: id,
  fields: {
    'Name@lang(en)': name,
    ...(icon === undefined ? {} : { Icon: { id: icon } }),
    ModelMain: 328041,
    ModelSub: 0,
    EquipSlotCategory: { fields: { Body: 1 } },
  },
});
/** A valid 1 x 1 PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export interface XivapiMock {
  /** Item rows returned for the equipment search; each row gets its own icon id when set. */
  candidates?: number;
  iconId?: number;
  /** Replaces the answer to `/api/asset`. */
  asset?: (route: Route) => Promise<void> | void;
}
/** Answers every route the demo uses on the reviewed origin. */
export async function mockXivapi(page: Page, options: XivapiMock = {}) {
  const { candidates = 2, iconId, asset } = options;
  await page.route('https://v2.xivapi.com/**', async (route) => {
    const url = new URL(route.request().url());
    const rows = (url.searchParams.get('rows') ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    switch (url.pathname) {
      case '/api/version':
        await route.fulfill({
          json: { versions: [{ key: V, names: ['latest'] }] },
        });
        return;
      case '/api/sheet/Stain':
        await route.fulfill({
          json: {
            version: V,
            schema: S,
            rows: rows.map((id) => ({
              row_id: id,
              fields: { 'Name@lang(en)': `Dye ${id}` },
            })),
          },
        });
        return;
      case '/api/sheet/Glasses':
        await route.fulfill({
          json: {
            version: V,
            schema: S,
            rows: rows.map((id) => ({
              row_id: id,
              fields: {
                'Name@lang(en)': `Glasses ${id}`,
                ...(iconId === undefined ? {} : { Icon: { id: iconId + 1 } }),
              },
            })),
          },
        });
        return;
      case '/api/search':
        await route.fulfill({
          json: {
            version: V,
            schema: S,
            results: Array.from({ length: candidates }, (_, i) =>
              item(i + 1, `Candidate ${i + 1}`, iconId),
            ),
          },
        });
        return;
      case '/api/asset':
        if (asset) await asset(route);
        else await route.fulfill({ body: PNG, contentType: 'image/png' });
        return;
      default:
        await route.fulfill({ status: 404, body: 'unexpected route' });
    }
  });
}

/** Names of the markers that stand for private data in the files the privacy tests load. */
export const CANARY_FILE = 'CANARY_FILE_NAME.chara';
/** A character document with a canary in every kind of place private data can sit. */
export const canaryDocument = (extra: Record<string, unknown> = {}) => ({
  Author: 'CANARY_AUTHOR',
  Nickname: 'CANARY_NICKNAME',
  Note: 'CANARY_NOTE',
  CANARY_KEY: 'CANARY_VALUE_UNDER_A_KEY',
  Nested: { CANARY_NESTED_KEY: { deep: ['CANARY_DEEP_ARRAY'] } },
  Tribe: 'Midlander',
  Gender: 'Masculine',
  HairTone: 0,
  Glasses: 12,
  Body: {
    ModelBase: 361,
    ModelVariant: 5,
    DyeId: 88,
    DyeId2: 77,
    CANARY_BODY_KEY: 'CANARY_BODY',
  },
  ...extra,
});

export const resolveButton = (page: Page) =>
  page.getByRole('button', {
    name: 'Resolve equipment and dye names',
    exact: true,
  });
// Holds every XIVAPI request except the version probe until `release()` is called.
export async function holdLookup(page: Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('https://v2.xivapi.com/**', async (route) => {
    if (route.request().url().includes('/version')) {
      await route.fulfill({
        json: { versions: [{ key: V, names: ['latest'] }] },
      });
      return;
    }
    await gate;
    await route
      .fulfill({ json: { version: V, schema: S, results: [item(1, 'Held')] } })
      .catch(() => {});
  });
  return () => release();
}
export async function answerLookup(page: Page, count = 1) {
  await page.route('https://v2.xivapi.com/**', (route) =>
    route.fulfill({
      json: route.request().url().includes('/version')
        ? { versions: [{ key: V, names: ['latest'] }] }
        : {
            version: V,
            schema: S,
            results: Array.from({ length: count }, (_, i) =>
              item(i + 1, `Candidate ${i + 1}`),
            ),
          },
    }),
  );
}
export const equipmentBody = { Body: { ModelBase: 361, ModelVariant: 5 } };
export const activeId = (page: Page) =>
  page.evaluate(() => document.activeElement?.id ?? '');

const HEADER_ALLOWED =
  /^(accept|accept-language|accept-encoding|origin|user-agent|priority|sec-[\w-]+)$/;

const SEARCH_FIELDS = [
  'Name@lang(de),Name@lang(en),Name@lang(fr),Name@lang(ja),Icon.id,ModelMain,ModelSub,LevelEquip,ItemUICategory.row_id',
  ...[
    'MainHand',
    'OffHand',
    'Head',
    'Body',
    'Gloves',
    'Legs',
    'Feet',
    'Ears',
    'Neck',
    'Wrists',
    'FingerL',
    'FingerR',
  ].map((slot) => `EquipSlotCategory.${slot}`),
  'DyeCount,IsGlamorous',
  ...[
    'Hyur',
    'Elezen',
    'Lalafell',
    'Miqote',
    'Roegadyn',
    'AuRa',
    'Hrothgar',
    'Viera',
    'Male',
    'Female',
  ].map((who) => `EquipRestriction.${who}`),
  'GrandCompany.row_id',
].join(',');
const ROWS = /^[0-9]+(,[0-9]+)*$/;
const VERSION = /^[0-9a-f]{16}$/;
const SCHEMA = /^exdschema@2:(ver:request|rev:[0-9a-f]{40})$/;
/**
 * The complete shape of each request a lookup may send to the reviewed origin: its route, exactly
 * the parameters it carries, and a value rule for every one of them. A parameter that is added, or
 * a value outside its rule, fails here, so private data cannot ride along in a field that no test
 * looked at. Identifiers are digits; everything else is a fixed word or a pattern with no free text.
 */
const SHAPES: Record<string, Record<string, string | RegExp>> = {
  '/api/version': {},
  '/api/sheet/Stain': {
    fields: 'Name@lang(en)',
    version: VERSION,
    schema: SCHEMA,
    language: 'en',
    transient: '',
    rows: ROWS,
  },
  '/api/sheet/Glasses': {
    fields: 'Name@lang(de),Name@lang(en),Name@lang(fr),Name@lang(ja),Icon.id',
    version: VERSION,
    schema: SCHEMA,
    language: 'en',
    transient: '',
    rows: ROWS,
  },
  '/api/search': {
    fields: SEARCH_FIELDS,
    version: VERSION,
    schema: SCHEMA,
    language: 'en',
    transient: '',
    limit: '500',
    sheets: 'Item',
    query:
      /^\+\((\(\+EquipSlotCategory\.[A-Za-z]+=1 \+ModelMain=[0-9]+\)( |(?=\))))+\)$/,
  },
  '/api/asset': {
    path: /^ui\/icon\/[0-9]{6}\/[0-9]{6}_hr1\.tex$/,
    format: 'png',
    version: VERSION,
  },
};
export const APPROVED_PATHS = Object.keys(SHAPES);
/**
 * What a lookup may send to the reviewed origin, as an allowlist: a GET without a body, cookies,
 * credentials or referrer, carrying only the headers a browser adds, to a fixed route, with the
 * route's exact parameters and value rules. A deny-list of private strings would pass a new
 * parameter, or a transformed copy of a private value.
 */
export function expectApproved(request: Recorded): void {
  const url = new URL(request.url);
  expect(request.method).toBe('GET');
  expect(request.postData).toBeNull();
  for (const header of ['cookie', 'authorization', 'referer'])
    expect(request.headers[header], header).toBeUndefined();
  // Only what the browser itself adds, plus the Accept header the client sets.
  for (const header of Object.keys(request.headers))
    expect(header, `header ${header}`).toMatch(HEADER_ALLOWED);
  expect(url.hash).toBe('');
  expect(url.username + url.password).toBe('');
  const shape = SHAPES[url.pathname];
  expect(shape, `route ${url.pathname}`).toBeDefined();
  const names = [...url.searchParams.keys()];
  expect(new Set(names).size, 'a repeated parameter').toBe(names.length);
  expect(names.sort()).toEqual(Object.keys(shape ?? {}).sort());
  for (const [name, rule] of Object.entries(shape ?? {})) {
    const value = url.searchParams.get(name) ?? '';
    if (typeof rule === 'string') expect(value, name).toBe(rule);
    else expect(value, name).toMatch(rule);
  }
}

/**
 * Holds every XIVAPI request except the version probe until `answer()` is called, answers the ones
 * that come after it at once, and records which requests the page started and which it gave up on
 * (Playwright reports a request the page aborts as failed). `answer()` also lets the requests that
 * were held reply, to a page that has already abandoned them.
 */
export async function controlLookup(page: Page, holdPaths?: readonly string[]) {
  const seen = { started: [] as string[], aborted: [] as string[] };
  let holding = true;
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.origin === 'https://v2.xivapi.com') seen.aborted.push(url.pathname);
  });
  await page.route('https://v2.xivapi.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/version') {
      await route.fulfill({
        json: { versions: [{ key: V, names: ['latest'] }] },
      });
      return;
    }
    seen.started.push(url.pathname);
    if (holding && (!holdPaths || holdPaths.includes(url.pathname))) await gate;
    const rows = (url.searchParams.get('rows') ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    const json =
      url.pathname === '/api/sheet/Stain'
        ? {
            version: V,
            schema: S,
            rows: rows.map((id) => ({
              row_id: id,
              fields: { 'Name@lang(en)': `Dye ${id}` },
            })),
          }
        : url.pathname === '/api/sheet/Glasses'
          ? {
              version: V,
              schema: S,
              rows: rows.map((id) => ({
                row_id: id,
                fields: { 'Name@lang(en)': `Round glasses ${id}` },
              })),
            }
          : {
              version: V,
              schema: S,
              results: [item(1, 'Candidate 1')],
            };
    await route.fulfill({ json }).catch(() => {});
  });
  return {
    seen,
    searches: () => seen.started.filter((p) => p === '/api/search').length,
    answer: () => {
      holding = false;
      open();
    },
  };
}
