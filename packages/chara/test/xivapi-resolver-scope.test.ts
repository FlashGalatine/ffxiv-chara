import { describe, expect, it } from 'vitest';
import { modelKey } from '../src/models.js';
import type { EquipmentModel } from '../src/types.js';
import {
  createXivapiResolver,
  type XivapiOptions,
} from '../src/xivapi/index.js';

// Every issue the resolver reports says which lookup it came from: "items" for the equipment search,
// "facewear" for the glasses row, and the slot after "items" for a problem with one slot. Callers
// route on these, so the whole issue object is asserted, not only its code.

const V = '0123456789abcdef';
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
const COLUMN = {
  Body: 'Body',
  MainHand: 'MainHand',
  OffHand: 'OffHand',
} as const;

const row = (
  rowId: number,
  model: EquipmentModel,
  modelSub: string | null = null,
  mutate: (fields: Record<string, unknown>) => void = () => {},
) => {
  const fields: Record<string, unknown> = {
    'Name@lang(en)': `Item ${rowId}`,
    Icon: { id: rowId },
    ModelMain: Number(modelKey(model)),
    ModelSub: modelSub === null ? null : Number(modelSub),
    EquipSlotCategory: {
      fields: { [COLUMN[model.slot as keyof typeof COLUMN]]: 1 },
    },
  };
  mutate(fields);
  return { sheet: 'Item', row_id: rowId, fields };
};
const glassesPage = {
  version: V,
  schema: S,
  rows: [{ row_id: 8, fields: { 'Name@lang(en)': 'Glasses' } }],
};
const resolver = (
  items: () => Response,
  glasses: () => Response,
  options: XivapiOptions = {},
) =>
  createXivapiResolver({
    version: V,
    schema: S,
    languages: ['en'],
    fetch: async (input) =>
      new URL(String(input)).pathname.endsWith('/search') ? items() : glasses(),
    ...options,
  });
const results = (rows: unknown[]) =>
  new Response(JSON.stringify({ version: V, schema: S, results: rows }));
const ok = () => new Response(JSON.stringify(glassesPage));
const down = () => new Response('{}', { status: 500 });

const ITEM_OUTAGE = {
  code: 'UPSTREAM_UNAVAILABLE',
  severity: 'warning',
  path: ['items'],
  message: 'Equipment lookup could not complete.',
};
const FACEWEAR_OUTAGE = { ...ITEM_OUTAGE, path: ['facewear'] };

describe('where an issue came from', () => {
  it('puts an equipment outage under "items" and leaves facewear unaffected', async () => {
    const r = await resolver(down, ok).resolve({
      models: [body],
      glassesId: 8,
    });
    expect(r.issues).toEqual([ITEM_OUTAGE]);
    expect(r.items.Body?.status).toBe('unavailable');
    expect(r.facewear?.status).toBe('matched');
  });

  it('puts a facewear outage under "facewear" and leaves the items unaffected', async () => {
    const r = await resolver(() => results([row(1, body)]), down).resolve({
      models: [body],
      glassesId: 8,
    });
    expect(r.issues).toEqual([FACEWEAR_OUTAGE]);
    expect(r.items.Body?.status).toBe('matched');
    expect(r.facewear?.status).toBe('unavailable');
  });

  it('lists the equipment issues first, then the facewear issues', async () => {
    const r = await resolver(down, down).resolve({
      models: [body],
      glassesId: 8,
    });
    expect(r.issues).toEqual([ITEM_OUTAGE, FACEWEAR_OUTAGE]);
  });

  it('keeps the severity and message of a row that was refused', async () => {
    const unrelated = row(2, { ...body, base: 999 });
    const r = await resolver(
      () => results([row(1, body), unrelated]),
      ok,
    ).resolve({
      models: [body],
    });
    expect(r.items.Body?.status).toBe('partial');
    expect(r.issues).toEqual([
      {
        code: 'INVALID_ROW',
        severity: 'warning',
        path: ['items'],
        message: 'An upstream row was rejected.',
      },
    ]);
  });

  it('reports nothing for a lookup that succeeded, empty or not', async () => {
    const r = await resolver(() => results([]), ok).resolve({
      models: [body],
      glassesId: 8,
    });
    expect(r.issues).toEqual([]);
    expect(r.items.Body?.status).toBe('notFound');
  });
});

describe('an off-hand model beside a main hand', () => {
  const offKey = modelKey(off);
  const mainKey = modelKey(main);

  it('flags the slot, not only the lookup, when the main-hand sub-model is unknown', async () => {
    const r = await resolver(() => results([row(301, main, null)]), ok).resolve(
      { models: [main, off] },
    );
    expect(r.issues).toEqual([
      {
        code: 'INCOMPLETE_OFFHAND_CONTEXT',
        severity: 'warning',
        path: ['items', 'OffHand'],
        message:
          'Missing main-hand model data prevents complete off-hand matching.',
      },
    ]);
    expect(r.items.OffHand).toMatchObject({
      status: 'partial',
      candidates: [],
    });
    expect(r.items.MainHand?.status).toBe('matched');
  });

  it('gives a paired main hand precedence over a direct off-hand row of the same model', async () => {
    const r = await resolver(
      () => results([row(301, main, offKey), row(401, off)]),
      ok,
    ).resolve({ models: [main, off] });
    expect(r.issues).toEqual([]);
    expect(
      r.items.OffHand?.candidates.map((c) => [c.itemId, c.viaMainHand]),
    ).toEqual([[301, true]]);
    expect(r.items.OffHand?.status).toBe('matched');
  });

  it('falls back to the direct off-hand row when the main hand does not pair', async () => {
    const r = await resolver(
      () => results([row(301, main, '1'), row(401, off)]),
      ok,
    ).resolve({ models: [main, off] });
    expect(r.issues).toEqual([]);
    expect(
      r.items.OffHand?.candidates.map((c) => [c.itemId, c.viaMainHand]),
    ).toEqual([[401, false]]);
  });

  it('offers a main hand that is also asked for as the off-hand, through itself', async () => {
    const r = await resolver(() => results([row(301, main, null)]), ok).resolve(
      {
        models: [main, { ...main, slot: 'OffHand' }],
      },
    );
    expect(mainKey).toBe(modelKey({ ...main, slot: 'OffHand' }));
    expect(r.issues).toEqual([]);
    expect(
      r.items.OffHand?.candidates.map((c) => [c.itemId, c.viaMainHand]),
    ).toEqual([[301, true]]);
  });

  it('orders the transport issues before the off-hand issue, items before facewear', async () => {
    const unrelated = row(2, { ...body, base: 999 });
    const r = await resolver(
      () => results([row(301, main, null), unrelated]),
      down,
    ).resolve({ models: [main, off], glassesId: 8 });
    expect(r.issues.map((issue) => [issue.code, issue.path.join('/')])).toEqual(
      [
        ['INVALID_ROW', 'items'],
        ['UPSTREAM_UNAVAILABLE', 'facewear'],
        ['INCOMPLETE_OFFHAND_CONTEXT', 'items/OffHand'],
      ],
    );
  });
});

describe('an off-hand model beside twin main hands', () => {
  it('stays partial, with the issue, when one twin pairs and another has no sub-model', async () => {
    const r = await resolver(
      () => results([row(301, main, modelKey(off)), row(302, main, null)]),
      ok,
    ).resolve({ models: [main, off] });
    expect(r.items.OffHand?.status).toBe('partial');
    expect(
      r.items.OffHand?.candidates.map((c) => [c.itemId, c.viaMainHand]),
    ).toEqual([[301, true]]);
    expect(r.issues).toEqual([
      {
        code: 'INCOMPLETE_OFFHAND_CONTEXT',
        severity: 'warning',
        path: ['items', 'OffHand'],
        message:
          'Missing main-hand model data prevents complete off-hand matching.',
      },
    ]);
  });
});

describe('the issues of a whole resolution', () => {
  it('are capped at 64, ending with the truncation marker', async () => {
    const unrelated = Array.from({ length: 100 }, (_, i) =>
      row(100 + i, { ...body, base: 999 }),
    );
    const r = await resolver(() => results(unrelated), down).resolve({
      models: [body],
      glassesId: 8,
    });
    expect(r.issues).toHaveLength(64);
    expect(r.issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    expect(r.issues[0]).toEqual({
      code: 'INVALID_ROW',
      severity: 'warning',
      path: ['items'],
      message: 'An upstream row was rejected.',
    });
  });
});
