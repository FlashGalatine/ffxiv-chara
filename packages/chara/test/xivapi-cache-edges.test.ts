import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EquipmentModel } from '../src/types.js';
import { admittedJson, createMemoryCache } from '../src/xivapi/cache.js';
import {
  type CachedRows,
  createXivapiClient,
  createXivapiResolver,
  type XivapiOptions,
} from '../src/xivapi/index.js';

// The edges of the cache gates that the first cache tests did not reach: the exact byte charges of
// admittedJson, non-ASCII sizes, the memory cache's eviction loop and exact limits, the shapes of a
// cache hit, what the client admits from a host cache, and a host cache that hangs.

const V = '0123456789abcdef';
const S = `exdschema@2:rev:${'a'.repeat(40)}`;
const MIB8 = 8 * 1024 * 1024;
const body: EquipmentModel = { slot: 'Body', base: 361, variant: 5 };
const wire = (rowId = 42, fields: Record<string, unknown> = {}) => ({
  sheet: 'Item',
  row_id: rowId,
  fields: {
    'Name@lang(en)': 'Example',
    Icon: { id: 123 },
    ModelMain: 328041,
    ModelSub: 0,
    EquipSlotCategory: { fields: { Body: 1 } },
    LevelEquip: 70,
    ItemUICategory: { row_id: 31 },
    DyeCount: 2,
    IsGlamorous: true,
    EquipRestriction: { fields: { Hyur: 1, Male: 1 } },
    GrandCompany: { row_id: 0 },
    ...fields,
  },
});
const pageOf = (results: unknown[], next?: string) => ({
  version: V,
  schema: S,
  results,
  ...(next === undefined ? {} : { next }),
});
const json = (data: unknown) => new Response(JSON.stringify(data));
const client = (fetch: typeof globalThis.fetch, options: XivapiOptions = {}) =>
  createXivapiClient({
    fetch,
    version: V,
    schema: S,
    languages: ['en'],
    ...options,
  });
afterEach(() => vi.useRealTimers());

/** A cache record whose JSON text has exactly this many characters (all ASCII). */
const entryOf = (textLength: number): CachedRows => {
  const chunk = 'x'.repeat(50_000);
  const make = (last: string, chunks: number) =>
    ({
      format: 1,
      namespace: 'n',
      version: V,
      schema: S,
      complete: true,
      rows: [],
      padding: [...new Array(chunks).fill(chunk), last],
    }) as unknown as CachedRows;
  // Each full chunk adds 50,003 characters (the quotes and a comma); the last string takes the rest.
  const chunks = Math.floor(
    (textLength - JSON.stringify(make('', 0)).length) / 50_003,
  );
  const rest = textLength - JSON.stringify(make('', chunks)).length;
  if (rest < 0 || rest > 65_536) throw new Error('That size cannot be built.');
  const record = make('y'.repeat(rest), chunks);
  if (JSON.stringify(record).length !== textLength)
    throw new Error('The record is not the size asked for.');
  return record;
};
const small = (): CachedRows => entryOf(400);

describe('the byte charges of admittedJson, to the byte', () => {
  it('charges an empty array or object its braces even when they sit inside another', () => {
    // A container is charged 2 bytes and each separator after it nothing, so the walk can be a byte
    // under the text: the final measure of the text is what refuses these.
    expect(admittedJson({ a: {}, b: {} }, 15)).toBe('{"a":{},"b":{}}');
    expect(admittedJson({ a: {}, b: {} }, 14)).toBeNull();
    // The walk alone refuses these: a key costs its JSON text plus one, a container 2.
    expect(admittedJson([[]], 8)).toBe('[[]]');
    expect(admittedJson([[]], 7)).toBeNull();
    expect(admittedJson([[]], 5)).toBeNull();
    expect(admittedJson([1], 31)).toBe('[1]');
    expect(admittedJson([1], 30)).toBeNull();
  });

  it('counts bytes of UTF-8 and not characters', () => {
    const text = 'é'.repeat(10); // 20 bytes, 22 with the quotes
    expect(admittedJson(text, 23)).toBe(JSON.stringify(text));
    expect(admittedJson(text, 22)).toBeNull();
    // The key "é" is 4 bytes in UTF-8 and 3 characters long; with its 1, the number's 25 and the braces' 2 the walk is 32.
    expect(admittedJson({ é: 1 }, 32)).toBe('{"é":1}');
    expect(admittedJson({ é: 1 }, 31)).toBeNull();
  });

  it('refuses an array that has a hole and a property whose name only looks like an index', () => {
    const leading = Object.assign([1, 2], { '01': 'x' });
    delete leading[1];
    const huge = Object.assign([1, 2], { '4294967295': 'x' });
    delete huge[1];
    for (const value of [leading, huge]) {
      expect(admittedJson(value)).toBeNull();
      expect(admittedJson({ v: value })).toBeNull();
    }
  });
});

describe('the memory cache at its limits', () => {
  it('evicts as many entries as the new one needs, not one', async () => {
    const part = () => entryOf(2_949_418);
    const cache = createMemoryCache();
    await cache.set('a', part(), 1000);
    await cache.set('b', part(), 1000);
    await cache.set('c', entryOf(6_553_600), 1000);
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('c')).not.toBeNull();
  });

  it('does not evict another entry when a key that is not the oldest is rewritten in a full cache', async () => {
    const cache = createMemoryCache();
    for (let i = 0; i < 128; i++) await cache.set(String(i), small(), 1000);
    await cache.set('5', small(), 1000);
    expect(await cache.get('0')).not.toBeNull();
    expect(await cache.get('5')).not.toBeNull();
    // The bytes of the old copy are not counted while the new one is placed.
    const large = createMemoryCache();
    const half = () => entryOf(4_200_000);
    await large.set('other', small(), 1000);
    await large.set('same', half(), 1000);
    await large.set('same', half(), 1000);
    expect(await large.get('other')).not.toBeNull();
  });

  it('drops an expired entry, at exactly its expiry, before it evicts a live one for lack of bytes', async () => {
    vi.useFakeTimers();
    const part = () => entryOf(2_949_418);
    const cache = createMemoryCache();
    await cache.set('live', part(), 86_400_000);
    await cache.set('expiring', part(), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await cache.set('new', part(), 1000);
    expect(await cache.get('live')).not.toBeNull();
    expect(await cache.get('new')).not.toBeNull();
    expect(await cache.get('expiring')).toBeNull();
  });

  it('stores an entry of exactly 8 MiB, key included, and not one byte more', async () => {
    const key = 'k'.repeat(16_384);
    const exact = entryOf(MIB8 - key.length);
    const over = entryOf(MIB8 - key.length + 1);
    // Both are admitted as values: only the memory cache's capacity separates them.
    expect(admittedJson(exact)).not.toBeNull();
    expect(admittedJson(over)).not.toBeNull();
    const first = createMemoryCache();
    await first.set(key, exact, 1000);
    expect(await first.get(key)).not.toBeNull();
    const second = createMemoryCache();
    await second.set(key, over, 1000);
    expect(await second.get(key)).toBeNull();
  });

  it('keeps two entries that fill 8 MiB exactly, and evicts the older for one byte more', async () => {
    const half = MIB8 / 2;
    const keyOf = (c: string) => c.repeat(100);
    const fits = createMemoryCache();
    await fits.set(keyOf('a'), entryOf(half - 100), 1000);
    await fits.set(keyOf('b'), entryOf(half - 100), 1000);
    expect(await fits.get(keyOf('a'))).not.toBeNull();
    expect(await fits.get(keyOf('b'))).not.toBeNull();
    const over = createMemoryCache();
    await over.set(keyOf('a'), entryOf(half - 100), 1000);
    await over.set(keyOf('b'), entryOf(half - 100 + 1), 1000);
    expect(await over.get(keyOf('a'))).toBeNull();
    expect(await over.get(keyOf('b'))).not.toBeNull();
  });

  it('counts the bytes of non-ASCII values and keys in UTF-8', async () => {
    // Three values of about 3 MB each in UTF-8, though only about 1 million characters.
    const kana = () =>
      ({
        ...entryOf(400),
        padding: new Array(50).fill('あ'.repeat(20_000)),
      }) as unknown as CachedRows;
    const cache = createMemoryCache();
    await cache.set('first', kana(), 1000);
    await cache.set('second', kana(), 1000);
    await cache.set('third', kana(), 1000);
    expect(await cache.get('first')).toBeNull();
    expect(await cache.get('third')).not.toBeNull();
    // Two ASCII values that fit in 8 MiB with ASCII keys do not fit with keys of 16,384 kana (49,152 bytes).
    const text = 4_160_000;
    const keyA = 'あ'.repeat(16_384);
    const keyB = 'い'.repeat(16_384);
    const keyed = createMemoryCache();
    await keyed.set(keyA, entryOf(text), 1000);
    await keyed.set(keyB, entryOf(text), 1000);
    expect(await keyed.get(keyA)).toBeNull();
    expect(await keyed.get(keyB)).not.toBeNull();
  });
});

describe('cache hits for rows of other shapes', () => {
  const store = () => {
    const backing = new Map<string, string>();
    return {
      get: async (key: string) =>
        backing.has(key)
          ? (JSON.parse(backing.get(key) as string) as CachedRows)
          : null,
      set: async (key: string, value: CachedRows) => {
        backing.set(key, JSON.stringify(value));
      },
    };
  };
  it.each([
    ['a ModelSub that is not zero', { ModelSub: 1234 }],
    ['a ModelSub that is null', { ModelSub: null }],
    ['a dye count of 0', { DyeCount: 0 }],
    ['a dye count of 1', { DyeCount: 1 }],
    ['an item that is not glamourable', { IsGlamorous: false }],
    ['an item with no glamour flag', { IsGlamorous: undefined }],
    ['a Grand Company that is not zero', { GrandCompany: { row_id: 3 } }],
    ['a level of zero', { LevelEquip: 0 }],
    ['no icon', { Icon: undefined }],
  ])('uses a recorded row with %s as a hit', async (_name, fields) => {
    const cache = store();
    const fetch = vi.fn(async () =>
      json(pageOf([wire(42, fields as Record<string, unknown>)])),
    );
    const first = await client(fetch, { cache }).searchItems([body]);
    expect(first.status).toBe('complete');
    const second = await client(fetch, { cache }).searchItems([body]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.rows).toEqual(first.rows);
  });

  it.each([
    ['a wear value of 1 where true was read', 'wear', 1],
    ['a glamourable value of 1 where true was read', 'glamourable', 1],
    ['a glamourable value of "true"', 'glamourable', 'true'],
    ['a dye count of "2"', 'dyeCount', '2'],
  ])('treats an entry with %s as a miss', async (_name, key, value) => {
    const backing = new Map<string, string>();
    const cache = {
      get: async (k: string) =>
        backing.has(k)
          ? (JSON.parse(backing.get(k) as string) as CachedRows)
          : null,
      set: async (k: string, v: CachedRows) => {
        backing.set(k, JSON.stringify(v));
      },
    };
    await client(async () => json(pageOf([wire()])), { cache }).searchItems([
      body,
    ]);
    const [stored] = [...backing.entries()];
    if (!stored) throw new Error('Expected a cache entry');
    const entry = JSON.parse(stored[1]) as {
      rows: { rules: Record<string, unknown> }[];
    };
    const rules = entry.rows[0]?.rules;
    if (!rules) throw new Error('Expected a cached row');
    if (key === 'wear') (rules.wear as Record<string, unknown>).Hyur = value;
    else rules[key] = value;
    backing.set(stored[0], JSON.stringify(entry));
    const again = vi.fn(async () => json(pageOf([wire()])));
    const result = await client(again, { cache }).searchItems([body]);
    expect(again).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('complete');
  });
});

describe('what the client admits from a host cache', () => {
  const recordedEntry = async () => {
    let written: string | undefined;
    await client(async () => json(pageOf([wire()])), {
      cache: {
        get: async () => null,
        set: async (_key, value) => {
          written = JSON.stringify(value);
        },
      },
    }).searchItems([body]);
    if (written === undefined) throw new Error('Expected a cache write.');
    return JSON.parse(written) as CachedRows & {
      rows: Record<string, unknown>[];
    };
  };
  const serveObject = async (entry: unknown) => {
    const fetch = vi.fn(async () => json(pageOf([wire()])));
    const result = await client(fetch, {
      cache: { get: async () => entry as CachedRows, set: async () => {} },
    }).searchItems([body]);
    return { fetch, result };
  };

  it('uses the entry itself when it is plain data', async () => {
    const { fetch } = await serveObject(await recordedEntry());
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a Map in a padding property',
      (e: Record<string, unknown>) => ({ ...e, padding: new Map() }),
    ],
    [
      'a cycle',
      (e: Record<string, unknown>) => {
        const loop: Record<string, unknown> = { ...e };
        loop.self = loop;
        return loop;
      },
    ],
    [
      'more than 8 MiB of padding',
      (e: Record<string, unknown>) => ({
        ...e,
        padding: new Array(129).fill('x'.repeat(65_536)),
      }),
    ],
    [
      'a symbol key',
      (e: Record<string, unknown>) => ({ ...e, [Symbol('x')]: 1 }),
    ],
  ])('treats an entry with %s as a miss', async (_name, damage) => {
    const entry = (await recordedEntry()) as unknown as Record<string, unknown>;
    const { fetch, result } = await serveObject(damage(entry));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('complete');
  });

  it('never runs a getter of the entry', async () => {
    const entry = await recordedEntry();
    let runs = 0;
    const row = entry.rows[0];
    if (!row) throw new Error('Expected a cached row');
    Object.defineProperty(row, 'iconId', {
      enumerable: true,
      get() {
        runs++;
        return 123;
      },
    });
    const { fetch } = await serveObject(entry);
    expect(runs).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('a resolution shares one budget with its cache hits and its hung cache', () => {
  const resolverOver = (
    fetch: typeof globalThis.fetch,
    cache: XivapiOptions['cache'],
    extra: XivapiOptions = {},
  ) =>
    createXivapiResolver({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
      ...(cache ? { cache } : {}),
      ...extra,
    });
  const glassesRow = { row_id: 8, fields: { 'Name@lang(en)': 'Glasses' } };

  it('counts the row of a cache hit against the 5,000 rows the items already used', async () => {
    const cache = createMemoryCache();
    let glasses = 0;
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/sheet/Glasses') {
        glasses++;
        return json({ version: V, schema: S, rows: [glassesRow] });
      }
      const at = Number(url.searchParams.get('cursor') ?? 0);
      return json(
        pageOf(
          Array.from({ length: 500 }, (_, i) => wire(at * 500 + i + 1)),
          at < 9 ? String(at + 1) : undefined,
        ),
      );
    };
    // Warm the cache with the Glasses row alone.
    const warm = await resolverOver(fetch, cache).resolve({
      models: [],
      glassesId: 8,
    });
    expect(warm.facewear?.status).toBe('matched');
    expect(glasses).toBe(1);
    // 10 pages of 500 rows are exactly the budget; the cached row would be the 5,001st.
    const result = await resolverOver(fetch, cache).resolve({
      models: [body],
      glassesId: 8,
    });
    expect(result.items.Body?.status).toBe('matched');
    expect(result.facewear?.status).toBe('unavailable');
    expect(result.issues.map((i) => [i.code, i.path.join('/')])).toContainEqual(
      ['ROW_LIMIT', 'facewear'],
    );
    expect(glasses).toBe(1);
  });

  it('stops using a cache that timed out, for the rest of the resolution', async () => {
    vi.useFakeTimers();
    let gets = 0;
    let sets = 0;
    const fetch: typeof globalThis.fetch = async (input) =>
      new URL(String(input)).pathname === '/api/sheet/Glasses'
        ? json({ version: V, schema: S, rows: [glassesRow] })
        : json(pageOf([wire()]));
    const pending = resolverOver(
      fetch,
      {
        get: () => {
          gets++;
          return new Promise<null>(() => {});
        },
        set: async () => {
          sets++;
        },
      },
      { timeoutMs: 20 },
    ).resolve({ models: [body], glassesId: 8 });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;
    expect(result.items.Body?.status).toBe('matched');
    expect(result.facewear?.status).toBe('matched');
    // One read timed out; nothing further is asked of that cache, and nothing is written to it.
    expect(gets).toBe(1);
    expect(sets).toBe(0);
  });
});
