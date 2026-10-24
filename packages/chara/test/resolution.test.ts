import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EquipmentModel,
  EquipmentResolveInput,
  EquipmentSlot,
} from '../src/types.js';
import {
  createMemoryCache,
  createXivapiResolver,
  type ItemRow,
  type XivapiOptions,
} from '../src/xivapi/index.js';

const fixture = JSON.parse(
  await readFile(
    new URL('../../../fixtures/expected/equipment-rows.json', import.meta.url),
    'utf8',
  ),
) as {
  rows: ItemRow[];
  cases: {
    models: EquipmentModel[];
    expected: Partial<Record<EquipmentSlot, number[]>>;
  }[];
};
const V = '0123456789abcdef';
const V2 = 'fedcba9876543210';
const S = `exdschema@2:rev:${'a'.repeat(40)}`;
const body: EquipmentModel = { slot: 'Body', base: 361, variant: 5 };
const main: EquipmentModel = {
  slot: 'MainHand',
  set: 634,
  base: 19,
  variant: 1,
};
const off: EquipmentModel = {
  slot: 'OffHand',
  set: 698,
  base: 149,
  variant: 1,
};
const columns: Record<EquipmentSlot, string> = {
  MainHand: 'MainHand',
  OffHand: 'OffHand',
  Body: 'Body',
  HeadGear: 'Head',
  Hands: 'Gloves',
  Legs: 'Legs',
  Feet: 'Feet',
  Ears: 'Ears',
  Neck: 'Neck',
  Wrists: 'Wrists',
  LeftRing: 'FingerL',
  RightRing: 'FingerR',
};
const wire = (r: ItemRow) => ({
  sheet: 'Item',
  row_id: r.rowId,
  fields: {
    ...Object.fromEntries(
      Object.entries(r.names).map(([lang, name]) => [
        `Name@lang(${lang})`,
        name,
      ]),
    ),
    Icon: { id: r.iconId },
    ModelMain: Number(r.modelMain),
    ModelSub: r.modelSub === null ? null : Number(r.modelSub),
    EquipSlotCategory: {
      fields: Object.fromEntries(r.slots.map((s) => [columns[s], 1])),
    },
    LevelEquip: r.levelEquip,
    ItemUICategory: { row_id: r.uiCategory },
    DyeCount: r.rules.dyeCount,
    IsGlamorous: r.rules.glamourable,
    EquipRestriction: { fields: r.rules.wear },
    GrandCompany: { row_id: r.rules.grandCompany },
  },
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const response = (rows: ItemRow[] = [], next?: string, version = V) =>
  json({
    version,
    schema: S,
    results: rows.map(wire),
    ...(next ? { next } : {}),
  });
const resolver = (
  fetch: typeof globalThis.fetch,
  options: XivapiOptions = {},
) => createXivapiResolver({ fetch, version: V, schema: S, ...options });
function source(rows = fixture.rows): typeof globalThis.fetch {
  return async (url) => {
    const u = new URL(String(url));
    const query = u.searchParams.get('query') ?? '';
    return response(
      rows.filter((row) =>
        row.slots.some((slot) =>
          query.includes(
            `+EquipSlotCategory.${columns[slot]}=1 +ModelMain=${row.modelMain})`,
          ),
        ),
      ),
    );
  };
}
afterEach(() => vi.useRealTimers());

describe('equipment candidates', () => {
  for (const [i, entry] of fixture.cases.entries())
    it(`matches reviewed synthetic relationships ${i + 1}`, async () => {
      const result = await resolver(source()).resolve({ models: entry.models });
      for (const [slot, ids] of Object.entries(entry.expected)) {
        const found = result.items[slot as EquipmentSlot];
        expect(found?.candidates.map((r) => r.itemId)).toEqual(ids);
        expect(found?.status).toBe(ids.length ? 'matched' : 'notFound');
      }
    });
  it('returns all ambiguous candidates in item ID order without filtering old names', async () => {
    const template = fixture.rows[0];
    if (!template) throw new Error('Fixture missing');
    const rows = Array.from({ length: 20 }, (_, i) => ({
      ...template,
      rowId: 100 - i,
      names: {
        en: ['Dated Coat', 'Deepmist Coat', 'Aetherial Coat'][i % 3] ?? '',
      },
    }));
    const r = await resolver(source(rows)).resolve({ models: [body] });
    expect(r.items.Body?.candidates.map((c) => c.itemId)).toEqual([
      81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98,
      99, 100,
    ]);
    expect(r.items.Body?.ambiguous).toBe(true);
    expect(r.items.Body?.modelKey).toBe('328041');
  });
  it('preserves each candidate rule value and keeps missing fields unknown', async () => {
    const r = await resolver(source()).resolve({ models: [body] });
    expect(r.items.Body?.candidates[0]?.rules).toEqual({
      dyeCount: null,
      glamourable: null,
      wear: {},
      grandCompany: null,
    });
    expect(r.items.Body?.candidates[1]?.rules).toEqual({
      dyeCount: 2,
      glamourable: true,
      wear: { Hyur: true, Female: true },
      grandCompany: 0,
    });
  });
  it.each(['quiver', 'focus', 'fist pair'])(
    'matches a %s only through the matching main-hand family',
    async (label) => {
      const paired = fixture.rows[4];
      const shield = fixture.rows[6];
      if (!paired || !shield) throw new Error('Fixture missing');
      const r = await resolver(
        source([
          paired,
          shield,
          { ...paired, rowId: 303, names: { en: label }, modelSub: '1' },
        ]),
      ).resolve({ models: [main, off] });
      expect(r.items.MainHand?.candidates.map((c) => c.itemId)).toEqual([
        301, 303,
      ]);
      expect(r.items.OffHand?.candidates.map((c) => c.itemId)).toEqual([301]);
      expect(r.items.OffHand?.candidates[0]?.viaMainHand).toBe(true);
    },
  );
  it('uses direct off-hand rows when known main-hand models do not pair', async () => {
    const paired = fixture.rows[4];
    const shield = fixture.rows[6];
    if (!paired || !shield) throw new Error('Fixture missing');
    const r = await resolver(
      source([{ ...paired, modelSub: '1' }, shield]),
    ).resolve({ models: [main, off] });
    expect(
      r.items.OffHand?.candidates.map((c) => [c.itemId, c.viaMainHand]),
    ).toEqual([[401, false]]);
  });
  it('does not pair an all-zero off-hand with a main hand whose ModelSub is also zero', async () => {
    const paired = fixture.rows[4];
    if (!paired) throw new Error('Fixture missing');
    // ModelSub 0 is XIVAPI's "no sub-model" value; off-hand key "0" means "nothing equipped".
    const r = await resolver(source([{ ...paired, modelSub: '0' }])).resolve({
      models: [main, { slot: 'OffHand', set: 0, base: 0, variant: 0 }],
    });
    expect(r.items.MainHand?.candidates.map((c) => c.itemId)).toEqual([301]);
    expect(r.items.OffHand).toMatchObject({
      modelKey: '0',
      status: 'notFound',
      candidates: [],
    });
    expect(r.issues.map((issue) => issue.code)).not.toContain(
      'INCOMPLETE_OFFHAND_CONTEXT',
    );
  });
  it('does not flag a missing main-hand ModelSub for an all-zero off-hand', async () => {
    const paired = fixture.rows[4];
    if (!paired) throw new Error('Fixture missing');
    const r = await resolver(source([{ ...paired, modelSub: null }])).resolve({
      models: [main, { slot: 'OffHand', set: 0, base: 0, variant: 0 }],
    });
    expect(r.items.MainHand?.candidates.map((c) => c.itemId)).toEqual([301]);
    expect(r.items.OffHand).toMatchObject({
      modelKey: '0',
      status: 'notFound',
      candidates: [],
    });
    expect(r.issues.map((issue) => issue.code)).not.toContain(
      'INCOMPLETE_OFFHAND_CONTEXT',
    );
  });
  it('does not reuse a cached off-hand selection across different main-hand contexts', async () => {
    const c = resolver(source(), { cache: createMemoryCache() });
    const a = await c.resolve({ models: [main, off] });
    const b = await c.resolve({ models: [{ ...main, set: 635 }, off] });
    const again = await c.resolve({ models: [main, off] });
    expect(a.items.OffHand?.candidates[0]?.itemId).toBe(301);
    expect(b.items.OffHand?.candidates[0]?.itemId).toBe(302);
    expect(again.items.OffHand?.candidates[0]?.itemId).toBe(301);
  });
  it('keeps slot models and returned candidates detached from callers and other slots', async () => {
    const input = structuredClone(fixture.cases[1]?.models ?? []);
    const result = await resolver(source()).resolve({ models: input });
    const left = result.items.LeftRing?.candidates[0];
    if (!left) throw new Error('Candidate missing');
    left.names.en = 'POISON';
    left.rules.wear.Hyur = false;
    expect(result.items.RightRing?.candidates[0]?.names.en).toBe(
      'Synthetic Ring',
    );
    expect(
      result.items.RightRing?.candidates[0]?.rules.wear.Hyur,
    ).toBeUndefined();
    const model = result.items.LeftRing?.model;
    if (!model) throw new Error('Model missing');
    model.base = 999;
    expect(input[0]?.base).toBe(7);
  });
});

describe('incomplete evidence and facewear', () => {
  it('counts facewear against encountered item rows even when item duplicates collapse', async () => {
    const row = fixture.rows[0];
    if (!row) throw new Error('Fixture missing');
    let pages = 0;
    const r = await resolver(async (url) =>
      String(url).includes('/Glasses')
        ? json({ version: V, schema: S, rows: [{ row_id: 8, fields: {} }] })
        : response(
            Array(500).fill(row),
            ++pages < 10 ? String(pages) : undefined,
          ),
    ).resolve({ models: [body], glassesId: 8 });
    expect(r.items.Body?.status).toBe('matched');
    expect(r.items.Body?.candidates).toHaveLength(1);
    expect(r.facewear?.status).toBe('unavailable');
    expect(r.issues.map((i) => i.code)).toContain('ROW_LIMIT');
  });
  it('shares response bytes across items and facewear while preserving the completed component', async () => {
    const row = fixture.rows[0];
    if (!row) throw new Error('Fixture missing');
    const padding = Object.fromEntries(
      Array.from({ length: 26 }, (_, i) => [String(i), 'x'.repeat(60_000)]),
    );
    let itemCalls = 0;
    const r = await resolver(async (url) => {
      if (String(url).includes('/Glasses'))
        return json({
          version: V,
          schema: S,
          rows: [{ row_id: 8, fields: {} }],
          padding,
        });
      return json({
        version: V,
        schema: S,
        results: [wire(row)],
        padding,
        ...(++itemCalls < 6 ? { next: String(itemCalls) } : {}),
      });
    }).resolve({ models: [body], glassesId: 8 });
    expect(r.items.Body?.status).toBe('matched');
    expect(r.facewear?.status).toBe('unavailable');
    expect(r.issues.map((i) => i.code)).toContain('RESPONSE_LIMIT');
  });
  it('uses one deadline across components and never starts facewear after it expires', async () => {
    vi.useFakeTimers();
    const row = fixture.rows[0];
    if (!row) throw new Error('Fixture missing');
    let calls = 0;
    let glassesCalls = 0;
    const pending = resolver(async (url) => {
      if (String(url).includes('/Glasses')) glassesCalls++;
      await new Promise((resolve) => setTimeout(resolve, 8000));
      return response([row], String(++calls));
    }).resolve({ models: [body], glassesId: 8 });
    await vi.advanceTimersByTimeAsync(30_000);
    const r = await pending;
    expect(r.items.Body?.status).toBe('partial');
    expect(r.facewear?.status).toBe('unavailable');
    expect(glassesCalls).toBe(0);
    expect(r.issues.map((i) => i.code)).toContain('DEADLINE');
  });
  it('bounds queued whole resolutions and active requests on a shared resolver', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const r = resolver(async () => {
      calls++;
      return new Promise<Response>(() => {});
    });
    const pending = Array.from({ length: 18 }, (_, i) =>
      r.resolve({ models: [{ ...body, variant: i + 1 }], glassesId: i + 1 }),
    );
    const extra = await r.resolve({
      models: [{ ...body, variant: 99 }],
      glassesId: 99,
    });
    expect(calls).toBe(2);
    expect(extra.issues.map((i) => i.code)).toContain('QUEUE_FULL');
    await vi.advanceTimersByTimeAsync(30_001);
    const finished = await Promise.all(pending);
    expect(
      finished.every((result) => result.items.Body?.status === 'unavailable'),
    ).toBe(true);
    expect(calls).toBeLessThanOrEqual(6);
  });
  it('coalesces full resolutions while cancelling one subscriber independently', async () => {
    let finish: ((r: Response) => void) | undefined;
    let calls = 0;
    const r = resolver(async () => {
      calls++;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const abort = new AbortController();
    const a = r.resolve({ models: [body] }, { signal: abort.signal });
    const b = r.resolve({ models: [body] });
    await vi.waitFor(() => expect(finish).toBeDefined());
    abort.abort();
    expect((await a).items.Body?.status).toBe('cancelled');
    const row = fixture.rows[0];
    if (!row) throw new Error('Fixture missing');
    finish?.(response([row]));
    expect((await b).items.Body?.status).toBe('matched');
    expect(calls).toBe(1);
  });
  it('preserves distinct version evidence when item and facewear aliases resolve differently', async () => {
    const row = fixture.rows[0];
    if (!row) throw new Error('Fixture missing');
    const r = await resolver(
      async (url) =>
        String(url).includes('/version')
          ? json({ versions: [] })
          : String(url).includes('/Glasses')
            ? json({
                version: V2,
                schema: S,
                rows: [{ row_id: 8, fields: {} }],
              })
            : response([row]),
      { version: 'latest' },
    ).resolve({ models: [body], glassesId: 8 });
    expect(r.items.Body?.status).toBe('matched');
    expect(r.facewear?.status).toBe('matched');
    expect(r.upstream).toEqual({
      items: { version: V, schema: S },
      facewear: { version: V2, schema: S },
    });
  });
  it('keeps matched equipment usable during a facewear outage', async () => {
    const row = fixture.rows[0];
    if (!row) throw new Error('Fixture missing');
    const r = await resolver(async (url) =>
      String(url).includes('/Glasses') ? json({}, 500) : response([row]),
    ).resolve({ models: [body], glassesId: 8 });
    expect(r.items.Body?.status).toBe('matched');
    expect(r.facewear?.status).toBe('unavailable');
  });
  it('shares the request budget across item and facewear lookups', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let itemCalls = 0;
    const row = fixture.rows[0];
    if (!row) throw new Error('Fixture missing');
    const pending = resolver(async (url) => {
      calls++;
      if (String(url).includes('/Glasses'))
        return json({ version: V, schema: S, rows: [] });
      itemCalls++;
      return itemCalls % 2
        ? json({}, 503)
        : response([row], itemCalls < 40 ? String(itemCalls) : undefined);
    }).resolve({ models: [body], glassesId: 8 });
    await vi.runAllTimersAsync();
    const r = await pending;
    expect(calls).toBeLessThanOrEqual(40);
    expect(r.issues.map((i) => i.code)).toContain('REQUEST_LIMIT');
  });
  it('does not turn empty per-slot candidates on a truncated batch into notFound', async () => {
    const row = fixture.rows[0];
    if (!row) throw new Error('Fixture missing');
    const r = await resolver(async () => response([row], 'more'), {
      maxPages: 1,
    }).resolve({ models: [body, { slot: 'HeadGear', base: 361, variant: 5 }] });
    expect(r.items.Body?.status).toBe('partial');
    expect(r.items.HeadGear?.status).toBe('partial');
    expect(r.items.HeadGear?.candidates).toEqual([]);
  });
  it('marks empty interrupted pagination unavailable, and retains unmatched identifiers', async () => {
    const r = await resolver(async () => response([], 'more'), {
      maxPages: 1,
    }).resolve({ models: [body] });
    expect(r.items.Body).toMatchObject({
      status: 'unavailable',
      model: body,
      modelKey: '328041',
      candidates: [],
    });
  });
  it('retains partial candidates when a later page fails', async () => {
    let calls = 0;
    const row = fixture.rows[0];
    if (!row) throw new Error('Fixture missing');
    const r = await resolver(async () =>
      ++calls === 1 ? response([row], 'more') : json({}, 500),
    ).resolve({ models: [body] });
    expect(r.items.Body?.status).toBe('partial');
    expect(r.items.Body?.candidates[0]?.itemId).toBe(101);
  });
  it('marks missing main-hand ModelSub evidence partial rather than a definitive direct match or miss', async () => {
    const mainRow = fixture.rows[4];
    const shield = fixture.rows[6];
    if (!mainRow || !shield) throw new Error('Fixture missing');
    for (const rows of [
      [{ ...mainRow, modelSub: null }],
      [{ ...mainRow, modelSub: null }, shield],
    ]) {
      const r = await resolver(source(rows)).resolve({ models: [main, off] });
      expect(r.items.OffHand?.status).toBe('partial');
      expect(r.issues.map((i) => i.code)).toContain(
        'INCOMPLETE_OFFHAND_CONTEXT',
      );
    }
  });
  it('keeps a successful facewear lookup usable during an equipment outage', async () => {
    const r = await resolver(
      async (url) =>
        String(url).includes('/Glasses')
          ? json({
              version: V2,
              schema: S,
              rows: [
                {
                  row_id: 8,
                  fields: {
                    'Name@lang(en)': 'Synthetic Glasses',
                    Icon: { id: 9 },
                  },
                },
              ],
            })
          : json({}, 500),
      { version: 'latest' },
    ).resolve({ models: [body], glassesId: 8 });
    expect(r.items.Body?.status).toBe('unavailable');
    expect(r.facewear).toMatchObject({
      id: 8,
      status: 'matched',
      candidates: [{ rowId: 8, names: { en: 'Synthetic Glasses' }, iconId: 9 }],
    });
    expect(r.upstream.facewear).toEqual({ version: V2, schema: S });
    expect(r.upstream.items).toEqual({ version: null, schema: null });
  });
  it('distinguishes absent facewear from a successfully unmatched requested ID including zero', async () => {
    const r = resolver(async (input) =>
      json(
        {
          code: 404,
          message: `not found: the Excel row Glasses/${new URL(String(input)).searchParams.get('rows')}:0 could not be found`,
        },
        404,
      ),
    );
    expect((await r.resolve({ models: [] })).facewear).toBeNull();
    expect(
      (await r.resolve({ models: [], glassesId: 0 })).facewear,
    ).toMatchObject({ id: 0, status: 'notFound', candidates: [] });
  });
  it('stops waiting on a hung host cache after its first timeout, across both components', async () => {
    vi.useFakeTimers();
    const hung = {
      get: () => new Promise<null>(() => {}),
      set: () => new Promise<void>(() => {}),
    };
    const pending = resolver(
      async (input) =>
        new URL(String(input)).pathname.endsWith('/sheet/Glasses')
          ? json({
              version: V,
              schema: S,
              rows: [
                {
                  row_id: 8,
                  fields: {
                    'Name@lang(en)': 'Synthetic Glasses',
                    Icon: { id: 9 },
                  },
                },
              ],
            })
          : response([]),
      { cache: hung },
    ).resolve({ models: [body], glassesId: 8 });
    await vi.advanceTimersByTimeAsync(35_000);
    const r = await pending;
    expect(r.items.Body?.status).toBe('notFound');
    expect(r.facewear).toMatchObject({ id: 8, status: 'matched' });
  });
  it('reads glassesId once, so a getter cannot change it after validation', async () => {
    let reads = 0;
    const input = {
      models: [],
      get glassesId() {
        return ++reads === 1 ? 8 : 70000;
      },
    } as unknown as EquipmentResolveInput;
    const rows: string[] = [];
    const r = await resolver(async (url) => {
      rows.push(new URL(String(url)).searchParams.get('rows') ?? '');
      return json({
        version: V,
        schema: S,
        rows: [{ row_id: 8, fields: { 'Name@lang(en)': 'Synthetic Glasses' } }],
      });
    }).resolve(input);
    expect(reads).toBe(1);
    expect(rows).toEqual(['8']);
    expect(r.facewear).toMatchObject({ id: 8, status: 'matched' });
  });
  it('accepts and honours a signal that is not an AbortSignal of this realm', async () => {
    class OtherSignal extends EventTarget {
      aborted = false;
    }
    const other = new OtherSignal();
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const pending = resolver(fetch).resolve(
      { models: [body] },
      { signal: other as unknown as AbortSignal },
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    other.aborted = true;
    other.dispatchEvent(new Event('abort'));
    expect((await pending).items.Body?.status).toBe('cancelled');
  });
  it('preserves caller cancellation for both item and facewear results', async () => {
    const abort = new AbortController();
    abort.abort();
    const r = await resolver(async () => {
      throw new Error('Must not fetch');
    }).resolve({ models: [body], glassesId: 8 }, { signal: abort.signal });
    expect(r.items.Body?.status).toBe('cancelled');
    expect(r.facewear?.status).toBe('cancelled');
  });
});

describe('resolver admission and privacy', () => {
  it('rejects invalid request options before I/O', async () => {
    const r = resolver(async () => {
      throw new Error('Must not fetch');
    });
    for (const options of [null, { signal: 'invalid' }])
      await expect(
        r.resolve(
          { models: [body] },
          options as unknown as { signal?: AbortSignal },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_LOOKUP' });
  });
  it.each([
    null,
    {},
    { models: [], glassesId: -1 },
    { models: [body], glassesId: '8' },
    { models: [{ ...body, base: -1 }] },
    { models: [body, { ...body, variant: 3 }] },
  ])(
    'rejects the whole invalid request before starting transport %j',
    async (value) => {
      let calls = 0;
      const r = resolver(async () => {
        calls++;
        return response();
      });
      await expect(
        r.resolve(value as EquipmentResolveInput),
      ).rejects.toMatchObject({ code: 'INVALID_LOOKUP' });
      expect(calls).toBe(0);
    },
  );
  it('captures only validated scalar input before awaiting fetch', async () => {
    let finish: ((r: Response) => void) | undefined;
    let url = '';
    const r = resolver(async (u) => {
      url = String(u);
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const input = {
      models: [{ ...body, Author: 'PRIVATE', DyeId: 66 }],
      Nickname: 'PRIVATE',
    };
    const pending = r.resolve(input);
    await vi.waitFor(() => expect(finish).toBeDefined());
    const model = input.models[0];
    if (!model) throw new Error('Missing input');
    model.base = 5;
    const row = fixture.rows[0];
    if (!row) throw new Error('Fixture missing');
    finish?.(response([row]));
    const result = await pending;
    expect(result.items.Body?.model).toEqual(body);
    expect(url).not.toContain('PRIVATE');
    expect(url).not.toContain('DyeId');
  });
});

describe('facewear rows that XIVAPI reports as missing', () => {
  it('reports a Glasses row the API says does not exist as not found, like the live API', async () => {
    const urls: string[] = [];
    const r = await resolver(async (input) => {
      const url = new URL(String(input));
      urls.push(url.pathname);
      return json(
        {
          code: 404,
          message: `not found: the Excel row Glasses/${url.searchParams.get('rows')}:0 could not be found`,
        },
        404,
      );
    }).resolve({ models: [], glassesId: 60000 });
    expect(r.facewear).toMatchObject({
      id: 60000,
      status: 'notFound',
      candidates: [],
    });
    expect(urls).toEqual(['/api/sheet/Glasses']);
  });
  it('does not take a missing sheet for a missing row', async () => {
    const r = await resolver(async () =>
      json(
        {
          code: 404,
          message: 'not found: the Excel sheet "Glasses" could not be found',
        },
        404,
      ),
    ).resolve({ models: [], glassesId: 8 });
    expect(r.facewear?.status).toBe('unavailable');
  });
});
