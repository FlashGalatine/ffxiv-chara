import { describe, expect, it, vi } from 'vitest';
import type { EquipmentModel } from '../src/types.js';
import { admittedJson, createMemoryCache } from '../src/xivapi/cache.js';
import {
  type CachedRows,
  createXivapiClient,
  type PublicRow,
  type ResolutionCache,
  type XivapiOptions,
} from '../src/xivapi/index.js';

// The cache gates are the evidence for THREAT_MODEL SEC-05: what a host cache may hand back is
// admitted (depth, size, shape) before it is cloned, parsed or trusted, and a hit is only used when
// it reproduces what a fresh response would have produced.

const V = '0123456789abcdef';
const S = `exdschema@2:rev:${'a'.repeat(40)}`;
const body: EquipmentModel = { slot: 'Body', base: 361, variant: 5 };
const wire = (rowId = 42) => ({
  sheet: 'Item',
  row_id: rowId,
  fields: {
    'Name@lang(en)': 'Example',
    'Name@lang(ja)': '例',
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
  },
});
const page = (results: unknown[]) => ({ version: V, schema: S, results });
const json = (data: unknown) => new Response(JSON.stringify(data));
const client = (fetch: typeof globalThis.fetch, options: XivapiOptions = {}) =>
  createXivapiClient({ fetch, version: V, schema: S, ...options });

describe('which host cache values are admitted', () => {
  const nested = (levels: number, wrap: (inner: unknown) => unknown) => {
    let value: unknown = 0;
    for (let i = 0; i < levels; i++) value = wrap(value);
    return value;
  };
  const count = (text: string | null): number => {
    if (text === null) throw new Error('Expected the value to be admitted.');
    return text.length;
  };

  it('returns the JSON text of an ordinary record, whatever the key order', () => {
    const record = {
      format: 1,
      list: [1, 'two', null, true, false, 0.5, -3, { deep: [] }],
      empty: {},
      text: 'é"\\\n',
    };
    expect(admittedJson(record)).toBe(JSON.stringify(record));
    expect(admittedJson(null)).toBe('null');
    expect(admittedJson('x')).toBe('"x"');
    expect(admittedJson(0)).toBe('0');
    const bare = Object.assign(Object.create(null), { a: 1 });
    expect(admittedJson(bare)).toBe('{"a":1}');
  });

  it.each([
    ['arrays', (inner: unknown) => [inner]],
    ['objects', (inner: unknown) => ({ k: inner })],
  ])(
    'allows %s to nest down to depth 32 and refuses depth 33',
    (_name, wrap) => {
      // The record itself is depth 1, so 31 wrappers put the innermost value at depth 32.
      expect(admittedJson(nested(31, wrap))).not.toBeNull();
      expect(admittedJson(nested(32, wrap))).toBeNull();
      expect(admittedJson(nested(33, wrap))).toBeNull();
    },
  );

  it('allows a string of 65,536 characters and refuses 65,537', () => {
    const exact = 'x'.repeat(65_536);
    expect(admittedJson(exact)).toBe(JSON.stringify(exact));
    expect(admittedJson({ v: exact })).not.toBeNull();
    expect(admittedJson('x'.repeat(65_537))).toBeNull();
    expect(admittedJson({ v: 'x'.repeat(65_537) })).toBeNull();
    expect(admittedJson(['x'.repeat(65_537)])).toBeNull();
  });

  it('allows a key of 1,024 characters and refuses 1,025', () => {
    expect(admittedJson({ ['k'.repeat(1024)]: 1 })).not.toBeNull();
    expect(admittedJson({ ['k'.repeat(1025)]: 1 })).toBeNull();
    expect(admittedJson({ outer: { ['k'.repeat(1025)]: 1 } })).toBeNull();
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['2 ** 53', 2 ** 53],
    ['-(2 ** 53)', -(2 ** 53)],
    ['1e300, an integer that is not safe', 1e300],
  ])('refuses the number %s, alone and nested', (_name, value) => {
    expect(admittedJson(value)).toBeNull();
    expect(admittedJson({ v: value })).toBeNull();
    expect(admittedJson([value])).toBeNull();
  });

  it.each([
    ['2 ** 53 - 1', 2 ** 53 - 1],
    ['-(2 ** 53 - 1)', -(2 ** 53 - 1)],
    ['a fraction', 0.1],
    ['a tiny fraction', 1e-300],
    ['a large fraction', 123_456_789.125],
    ['zero', 0],
  ])('allows the number %s', (_name, value) => {
    expect(admittedJson({ v: value })).toBe(JSON.stringify({ v: value }));
  });

  it.each([
    ['a Map', () => new Map([['a', 1]])],
    ['a Set', () => new Set([1])],
    ['a Date', () => new Date(0)],
    ['a RegExp', () => /x/],
    ['a class instance', () => new (class Row {})()],
    [
      'an object with a custom prototype',
      () => Object.create({ inherited: 1 }),
    ],
    ['an Error', () => new Error('x')],
    ['a typed array', () => new Uint8Array(2)],
    ['an array subclass', () => new (class List extends Array {})()],
    ['an array with a null prototype', () => Object.setPrototypeOf([], null)],
  ])('refuses %s, alone and nested', (_name, make) => {
    expect(admittedJson(make())).toBeNull();
    expect(admittedJson({ v: make() })).toBeNull();
    expect(admittedJson([make()])).toBeNull();
  });

  it('refuses symbol keys, enumerable or not, at any level', () => {
    const symbol = Symbol('hidden');
    const enumerable = { a: 1, [symbol]: 2 };
    const hidden = Object.defineProperty({ a: 1 }, symbol, {
      value: 2,
      enumerable: false,
    });
    for (const value of [enumerable, hidden]) {
      expect(admittedJson(value)).toBeNull();
      expect(admittedJson({ outer: value })).toBeNull();
      expect(admittedJson([value])).toBeNull();
    }
  });

  it('refuses sparse arrays and arrays that carry other properties', () => {
    // biome-ignore lint/suspicious/noSparseArray: the case under test
    const sparse = [1, , 3];
    const trailing: unknown[] = [1];
    trailing.length = 3;
    const labelled = Object.assign([1, 2], { label: 'x' });
    // One element is missing and one property is not an index: the number of keys still equals the
    // length, so only the check of each key tells this from a plain array.
    const swapped = Object.assign([1, 2], { label: 'x' });
    delete swapped[1];
    const indexed = Object.assign([1, 2], { '07': 'x' });
    for (const value of [sparse, trailing, labelled, indexed, swapped]) {
      expect(admittedJson(value)).toBeNull();
      expect(admittedJson({ v: value })).toBeNull();
    }
    expect(admittedJson([1, 2, 3])).toBe('[1,2,3]');
    expect(admittedJson([])).toBe('[]');
  });

  it('refuses accessors without running them, and any own toJSON', () => {
    let executed = 0;
    const getter = Object.defineProperty({}, 'v', {
      enumerable: true,
      get() {
        executed++;
        return 1;
      },
    });
    const elementGetter = Object.defineProperty([0], '0', {
      enumerable: true,
      get() {
        executed++;
        return 1;
      },
    });
    const hook = (enumerable: boolean) =>
      Object.defineProperty({ a: 1 }, 'toJSON', {
        enumerable,
        value() {
          executed++;
          return {};
        },
      });
    for (const value of [getter, elementGetter, hook(true), hook(false)]) {
      expect(admittedJson(value)).toBeNull();
      expect(admittedJson({ outer: [value] })).toBeNull();
    }
    expect(executed).toBe(0);
  });

  it('refuses cycles but allows an object that is merely referenced twice', () => {
    const self: Record<string, unknown> = {};
    self.self = self;
    const loop: unknown[] = [];
    loop.push({ inner: loop });
    expect(admittedJson(self)).toBeNull();
    expect(admittedJson(loop)).toBeNull();
    expect(admittedJson({ a: { b: self } })).toBeNull();
    const shared = { a: 1 };
    const twice = { x: shared, y: shared, z: [shared, shared] };
    expect(admittedJson(twice)).toBe(JSON.stringify(twice));
  });

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
    ['a bigint', 1n],
  ])('refuses %s, alone and nested', (_name, value) => {
    expect(admittedJson(value)).toBeNull();
    expect(admittedJson({ v: value })).toBeNull();
    expect(admittedJson([value])).toBeNull();
  });

  it('counts every value and every key against a cap of 100,000 nodes', () => {
    // An array of n numbers has 1 + 2n nodes: the array, and an index and a value for each element.
    expect(count(admittedJson(new Array(49_999).fill(1)))).toBeGreaterThan(0);
    expect(admittedJson(new Array(50_000).fill(1))).toBeNull();
    const keyed: Record<string, number> = {};
    for (let i = 0; i < 49_999; i++) keyed[`k${i}`] = 1;
    expect(admittedJson(keyed)).not.toBeNull();
    keyed.extra = 1;
    expect(admittedJson(keyed)).toBeNull();
  });

  it('caps the serialized size, 8 MiB unless the caller lowers it', () => {
    const chunk = 'x'.repeat(65_536);
    expect(admittedJson(new Array(127).fill(chunk))).not.toBeNull();
    expect(admittedJson(new Array(128).fill(chunk))).toBeNull();
    // The size of a string is its JSON text plus one byte; the limit itself is allowed.
    const ten = 'x'.repeat(10);
    expect(admittedJson(ten, 13)).toBe(JSON.stringify(ten));
    expect(admittedJson(ten, 12)).toBeNull();
    expect(admittedJson([1, 2, 3], 5)).toBeNull();
  });

  it('charges 25 bytes for a number, boolean or null and 2 for an empty array or object', () => {
    for (const scalar of [1, true, null]) {
      expect(admittedJson(scalar, 24)).toBeNull();
      expect(admittedJson(scalar, 25)).toBe(JSON.stringify(scalar));
    }
    expect(admittedJson({}, 1)).toBeNull();
    expect(admittedJson({}, 2)).toBe('{}');
    expect(admittedJson([], 1)).toBeNull();
    expect(admittedJson([], 2)).toBe('[]');
  });
});

describe('the in-memory cache', () => {
  const V1 = V;
  const record = (padding: string[] = []): CachedRows =>
    ({
      format: 1,
      namespace: 'n',
      version: V1,
      schema: S,
      complete: true,
      rows: [],
      ...(padding.length ? { padding } : {}),
    }) as CachedRows;
  const names = async (cache: ResolutionCache, keys: string[]) => {
    const found: string[] = [];
    // Reading refreshes an entry, so a key that is read last is the last one that is looked at.
    for (const key of keys)
      if ((await cache.get(key)) !== null) found.push(key);
    return found;
  };

  it('keeps 128 entries and evicts the oldest when a 129th arrives', async () => {
    const cache = createMemoryCache();
    for (let i = 0; i < 128; i++) await cache.set(String(i), record(), 1000);
    expect(await names(cache, ['0', '1', '127'])).toEqual(['0', '1', '127']);
    const fresh = createMemoryCache();
    for (let i = 0; i < 129; i++) await fresh.set(String(i), record(), 1000);
    expect(await fresh.get('0')).toBeNull();
    expect(await fresh.get('1')).not.toBeNull();
    expect(await fresh.get('128')).not.toBeNull();
  });

  it('treats a read as a use: the entry read survives and the next one goes', async () => {
    const cache = createMemoryCache();
    for (let i = 0; i < 128; i++) await cache.set(String(i), record(), 1000);
    expect(await cache.get('0')).not.toBeNull();
    await cache.set('128', record(), 1000);
    expect(await cache.get('0')).not.toBeNull();
    expect(await cache.get('1')).toBeNull();
    expect(await cache.get('2')).not.toBeNull();
    expect(await cache.get('128')).not.toBeNull();
  });

  it('treats writing an existing key as a use, and replaces its value', async () => {
    const cache = createMemoryCache();
    for (let i = 0; i < 128; i++) await cache.set(String(i), record(), 1000);
    await cache.set('0', { ...record(), namespace: 'again' }, 1000);
    await cache.set('128', record(), 1000);
    expect((await cache.get('0'))?.namespace).toBe('again');
    expect(await cache.get('1')).toBeNull();
    // Replacing a key does not leave a second copy that counts against the 128.
    const small = createMemoryCache();
    for (let i = 0; i < 200; i++) await small.set('same', record(), 1000);
    for (let i = 0; i < 127; i++) await small.set(`other${i}`, record(), 1000);
    expect(await small.get('same')).not.toBeNull();
  });

  it('removes an expired entry when it is read, and not before', async () => {
    vi.useFakeTimers();
    try {
      const cache = createMemoryCache();
      await cache.set('a', record(), 1000);
      await vi.advanceTimersByTimeAsync(999);
      expect(await cache.get('a')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(await cache.get('a')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops expired entries before it evicts a live one', async () => {
    vi.useFakeTimers();
    try {
      const cache = createMemoryCache();
      await cache.set('long-lived', record(), 7 * 86400_000);
      await cache.set('short-lived', record(), 1000);
      for (let i = 0; i < 126; i++)
        await cache.set(`f${i}`, record(), 86400_000);
      await vi.advanceTimersByTimeAsync(1001);
      // 128 entries are held, one of them expired: the new entry replaces that one.
      await cache.set('new', record(), 1000);
      expect(await cache.get('long-lived')).not.toBeNull();
      expect(await cache.get('new')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the least recently used entries until the 8 MiB capacity holds', async () => {
    const big = () => record(new Array(45).fill('x'.repeat(65_536)));
    const cache = createMemoryCache();
    await cache.set('first', big(), 1000);
    await cache.set('second', big(), 1000);
    expect(await cache.get('first')).not.toBeNull(); // first is now newer than second
    await cache.set('third', big(), 1000); // about 8.8 MB in all: one entry has to go
    expect(await cache.get('second')).toBeNull();
    expect(await cache.get('first')).not.toBeNull();
    expect(await cache.get('third')).not.toBeNull();
  });

  it('counts the key against the capacity as well as the value', async () => {
    const cache = createMemoryCache();
    // Each value is about 4.19 MB: two of them fit in 8 MiB (8,388,608 bytes) with about 10 KB to
    // spare, but two keys of 16,384 characters do not.
    const body = record([
      ...new Array(63).fill('x'.repeat(65_536)),
      'y'.repeat(60_000),
    ]);
    const text = JSON.stringify(body).length;
    expect(admittedJson(body)).not.toBeNull();
    expect(text * 2).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect((text + 16_384) * 2).toBeGreaterThan(8 * 1024 * 1024);
    await cache.set('a'.repeat(16_384), body, 1000);
    await cache.set('b'.repeat(16_384), body, 1000);
    expect(await cache.get('a'.repeat(16_384))).toBeNull();
    expect(await cache.get('b'.repeat(16_384))).not.toBeNull();
  });

  it('does not store an entry whose value and key together exceed 8 MiB, and keeps what it holds', async () => {
    const cache = createMemoryCache();
    const big = record([
      ...new Array(127).fill('x'.repeat(65_536)),
      'y'.repeat(62_500),
    ]);
    // Admitted as a value (under 8 MiB) but, with a long key, over the capacity of the cache.
    expect(admittedJson(big)).not.toBeNull();
    expect(JSON.stringify(big).length + 16_384).toBeGreaterThan(
      8 * 1024 * 1024,
    );
    await cache.set('kept', record(), 1000);
    await cache.set('k'.repeat(16_384), big, 1000);
    expect(await cache.get('k'.repeat(16_384))).toBeNull();
    expect(await cache.get('kept')).not.toBeNull();
  });

  it('does not count the bytes of a key again each time the key is written', async () => {
    const cache = createMemoryCache();
    const part = record(new Array(40).fill('x'.repeat(65_536))); // about 2.6 MB
    await cache.set('other', record(), 1000);
    for (let i = 0; i < 4; i++) await cache.set('same', part, 1000);
    // Four writes of 2.6 MB would be 10.5 MB if each were added to the last instead of replacing it.
    expect(await cache.get('other')).not.toBeNull();
    expect(await cache.get('same')).not.toBeNull();
  });

  it('ignores a write with a time to live of zero without evicting anything', async () => {
    const cache = createMemoryCache();
    for (let i = 0; i < 128; i++) await cache.set(String(i), record(), 1000);
    await cache.set('zero', record(), 0);
    expect(await cache.get('zero')).toBeNull();
    expect(await cache.get('0')).not.toBeNull();
  });

  it('ignores writes with a long key or a time to live outside (0, 7 days]', async () => {
    const cache = createMemoryCache();
    await cache.set('k'.repeat(16_384), record(), 1000);
    await cache.set('k'.repeat(16_385), record(), 1000);
    expect(await cache.get('k'.repeat(16_384))).not.toBeNull();
    expect(await cache.get('k'.repeat(16_385))).toBeNull();
    await cache.set('week', record(), 7 * 86400_000);
    expect(await cache.get('week')).not.toBeNull();
    for (const ttl of [0, -1, 7 * 86400_000 + 1, Number.NaN, Infinity]) {
      await cache.set('bad', record(), ttl);
      expect(await cache.get('bad')).toBeNull();
    }
    await cache.set(5 as unknown as string, record(), 1000);
    expect(await cache.get(5 as unknown as string)).toBeNull();
  });

  it('hands out a fresh copy on every read', async () => {
    const cache = createMemoryCache();
    await cache.set('a', record(), 1000);
    const first = await cache.get('a');
    if (!first) throw new Error('Expected an entry');
    first.namespace = 'changed';
    expect((await cache.get('a'))?.namespace).toBe('n');
  });
});

describe('a cache hit must reproduce what a fresh response gives', () => {
  const recorded = async (options: XivapiOptions = {}) => {
    let written: string | undefined;
    await client(async () => json(page([wire()])), {
      ...options,
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
  const served = async (entry: unknown, options: XivapiOptions = {}) => {
    const fetch = vi.fn(async () => json(page([wire()])));
    const result = await client(fetch, {
      ...options,
      cache: {
        get: async () => structuredClone(entry) as CachedRows,
        set: async () => {},
      },
    }).searchItems([body]);
    return { fetch, result };
  };
  const row = (entry: { rows: Record<string, unknown>[] }) => {
    const first = entry.rows[0];
    if (!first) throw new Error('Expected a cached row');
    return first;
  };
  const rules = (entry: { rows: Record<string, unknown>[] }) =>
    row(entry).rules as Record<string, unknown>;

  it('uses an untouched entry and does not fetch', async () => {
    const entry = await recorded();
    const { fetch, result } = await served(entry);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.status).toBe('complete');
    expect(result.rows[0]).toMatchObject({
      rowId: 42,
      names: { en: 'Example', ja: '例' },
      iconId: 123,
      modelMain: '328041',
      levelEquip: 70,
      uiCategory: 31,
    });
  });

  it.each([
    [
      'a property the public row does not have',
      (e: { rows: Record<string, unknown>[] }) => {
        row(e).extra = 1;
      },
    ],
    [
      'a name in a language that was not asked for',
      (e: { rows: Record<string, unknown>[] }) => {
        (row(e).names as Record<string, string>).ja = '例';
      },
    ],
    [
      'a property inside the rules',
      (e: { rows: Record<string, unknown>[] }) => {
        rules(e).extra = true;
      },
    ],
    [
      'a wear value that is not a boolean',
      (e: { rows: Record<string, unknown>[] }) => {
        (rules(e).wear as Record<string, unknown>).Hyur = 'yes';
      },
    ],
    [
      'a glamourable value that is not a boolean',
      (e: { rows: Record<string, unknown>[] }) => {
        rules(e).glamourable = 'maybe';
      },
    ],
    [
      'a dye count above 2',
      (e: { rows: Record<string, unknown>[] }) => {
        rules(e).dyeCount = 3;
      },
    ],
    [
      'an icon that is text',
      (e: { rows: Record<string, unknown>[] }) => {
        row(e).iconId = '123';
      },
    ],
    [
      'a level above 65535',
      (e: { rows: Record<string, unknown>[] }) => {
        row(e).levelEquip = 70_000;
      },
    ],
    [
      'a category that is text',
      (e: { rows: Record<string, unknown>[] }) => {
        row(e).uiCategory = '31';
      },
    ],
    [
      'a slot listed twice',
      (e: { rows: Record<string, unknown>[] }) => {
        row(e).slots = ['Body', 'Body'];
      },
    ],
  ])('treats an entry with %s as a miss and fetches', async (_name, tamper) => {
    // Only English is asked for, so a Japanese name is not part of what a fresh response gives.
    const options = { languages: ['en' as const] };
    const entry = await recorded(options);
    const fresh = (await served(entry, options)).result.rows;
    expect(fresh[0]?.names).toEqual({ en: 'Example' });
    tamper(entry);
    const { fetch, result } = await served(entry, options);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('complete');
    expect(result.rows).toEqual(fresh);
  });

  it('treats an item entry with a repeated or descending row as a miss', async () => {
    const two = async () => {
      let written: string | undefined;
      await client(async () => json(page([wire(42), wire(43)])), {
        cache: {
          get: async () => null,
          set: async (_key, value) => {
            written = JSON.stringify(value);
          },
        },
      }).searchItems([body]);
      return JSON.parse(written ?? 'null') as CachedRows & {
        rows: unknown[];
      };
    };
    const reload = async (entry: unknown) => {
      const fetch = vi.fn(async () => json(page([wire(42), wire(43)])));
      const result = await client(fetch, {
        cache: {
          get: async () => structuredClone(entry) as CachedRows,
          set: async () => {},
        },
      }).searchItems([body]);
      return { fetch, result };
    };
    const entry = await two();
    expect((await reload(entry)).fetch).not.toHaveBeenCalled();
    const repeated = structuredClone(entry);
    const [one, two43] = entry.rows as [PublicRow, PublicRow];
    repeated.rows = [one, one];
    const descending = structuredClone(entry);
    descending.rows = [two43, one];
    for (const bad of [repeated, descending]) {
      const { fetch, result } = await reload(bad);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.rows.map((r) => r.rowId)).toEqual([42, 43]);
    }
  });

  it('treats a dye-name entry with a name that is not trimmed as a miss', async () => {
    const stains = (name: string) =>
      json({
        version: V,
        schema: S,
        rows: [{ row_id: 2, fields: { 'Name@lang(en)': name } }],
      });
    let written: string | undefined;
    const options = { languages: ['en' as const] };
    await client(async () => stains(' Ash Grey '), {
      ...options,
      cache: {
        get: async () => null,
        set: async (_key, value) => {
          written = JSON.stringify(value);
        },
      },
    }).getStains([2]);
    const entry = JSON.parse(written ?? 'null') as CachedRows & {
      rows: { names: Record<string, string> }[];
    };
    expect(entry.rows[0]?.names.en).toBe('Ash Grey');
    const reload = async (stored: unknown) => {
      const fetch = vi.fn(async () => stains(' Ash Grey '));
      const result = await client(fetch, {
        ...options,
        cache: {
          get: async () => structuredClone(stored) as CachedRows,
          set: async () => {},
        },
      }).getStains([2]);
      return { fetch, result };
    };
    expect((await reload(entry)).fetch).not.toHaveBeenCalled();
    const padded = structuredClone(entry);
    const first = padded.rows[0];
    if (!first) throw new Error('Expected a cached row');
    first.names.en = ' Ash Grey ';
    const missed = await reload(padded);
    expect(missed.fetch).toHaveBeenCalledTimes(1);
    expect(missed.result.rows[0]?.names.en).toBe('Ash Grey');
    const extra = structuredClone(entry);
    Object.assign(extra.rows[0] ?? {}, { extra: 1 });
    expect((await reload(extra)).fetch).toHaveBeenCalledTimes(1);
  });
});
