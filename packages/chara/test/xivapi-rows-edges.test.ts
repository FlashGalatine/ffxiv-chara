import { describe, expect, it, vi } from 'vitest';
import { createDyeNameResolver } from '../src/dyes/index.js';
import type { EquipmentModel } from '../src/types.js';
import {
  createMemoryCache,
  createXivapiClient,
  createXivapiResolver,
  type GlassesRow,
  type ItemRow,
  type Language,
  type StainRow,
  type XivapiOptions,
} from '../src/xivapi/index.js';
import {
  associated,
  normalizeRow,
  normalizeStainRow,
} from '../src/xivapi/rows.js';

// Row, query and option edges that the first rows, limits and scope tests left to chance.

const V = '0123456789abcdef';
const S = `exdschema@2:rev:${'a'.repeat(40)}`;
const body: EquipmentModel = { slot: 'Body', base: 361, variant: 5 };
const json = (data: unknown) => new Response(JSON.stringify(data));
const item = (fields: Record<string, unknown> = {}) =>
  normalizeRow(
    {
      row_id: 7,
      fields: {
        ModelMain: 5,
        EquipSlotCategory: { fields: { Body: 1 } },
        ...fields,
      },
    },
    ['en'],
    true,
  ) as ItemRow | null;

describe('the wear columns of an item row', () => {
  it('keeps each of the ten columns, with a true or false for each kind of value', () => {
    const wear = item({
      EquipRestriction: {
        fields: {
          Hyur: 1,
          Elezen: 0,
          Lalafell: true,
          Miqote: false,
          Roegadyn: 1,
          AuRa: 0,
          Hrothgar: true,
          Viera: false,
          Male: 1,
          Female: 0,
        },
      },
    })?.rules.wear;
    expect(wear).toEqual({
      Hyur: true,
      Elezen: false,
      Lalafell: true,
      Miqote: false,
      Roegadyn: true,
      AuRa: false,
      Hrothgar: true,
      Viera: false,
      Male: true,
      Female: false,
    });
  });
});

describe('a glasses row that is not a record of fields', () => {
  it.each([null, 'x', 7, [], undefined])(
    'refuses %j instead of the fields',
    (fields) => {
      expect(normalizeRow({ row_id: 8, fields }, ['en'], false)).toBeNull();
    },
  );

  it('reports such a row from the API as INVALID_ROW and keeps the lookup partial', async () => {
    const result = await createXivapiClient({
      version: V,
      schema: S,
      languages: ['en'],
      fetch: async () =>
        json({
          version: V,
          schema: S,
          rows: [{ row_id: 8, fields: 7 }],
        }),
    }).getGlasses(8);
    expect(result.rows).toEqual([]);
    expect(result.issues.map((i) => i.code)).toEqual(['INVALID_ROW']);
  });
});

describe('names are kept as received, except that dye names are trimmed', () => {
  it('keeps the spaces around an item name and an empty one', () => {
    expect(item({ 'Name@lang(en)': ' Coat ' })?.names.en).toBe(' Coat ');
    expect(item({ 'Name@lang(en)': '' })?.names).toEqual({ en: '' });
  });

  it('trims a dye name of every kind of white space, tabs and ideographic spaces included', () => {
    const name = (value: string) =>
      normalizeStainRow({ row_id: 3, fields: { 'Name@lang(en)': value } }, [
        'en',
      ])?.names.en;
    expect(name('\tAsh　')).toBe('Ash');
    expect(name('　　')).toBe('');
    expect(name(' \n Ash Grey \r\n')).toBe('Ash Grey');
  });
});

describe('a row that belongs to a dye lookup is only a dye', () => {
  const glasses: GlassesRow = { rowId: 3, names: {}, iconId: null };
  const dye: StainRow = { rowId: 3, names: { en: 'Ash' } };
  const lookup = { stains: [2, 3] };
  const model: ItemRow = {
    rowId: 3,
    names: {},
    iconId: null,
    modelMain: '5',
    modelSub: null,
    slots: ['Body'],
    levelEquip: null,
    uiCategory: null,
    rules: { dyeCount: null, glamourable: null, wear: {}, grandCompany: null },
  };

  it('refuses a glasses row whose id is in the list', () => {
    expect(associated(glasses, lookup)).toBe(false);
    expect(associated(dye, lookup)).toBe(true);
  });

  it('refuses an item row whose id is in the list, with or without an icon', () => {
    expect(associated(model, lookup)).toBe(false);
    const { iconId: _icon, ...withoutIcon } = model;
    expect(associated(withoutIcon as unknown as ItemRow, lookup)).toBe(false);
  });
});

describe('lookups that differ only in the order or repeats of their input share one request', () => {
  it('shares a request between dye lookups', async () => {
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const rows = (new URL(String(input)).searchParams.get('rows') ?? '')
        .split(',')
        .map(Number);
      return json({
        version: V,
        schema: S,
        rows: rows.map((id) => ({
          row_id: id,
          fields: { 'Name@lang(en)': `Dye ${id}` },
        })),
      });
    });
    const c = createXivapiClient({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });
    const [first, second] = await Promise.all([
      c.getStains([30, 2, 7]),
      c.getStains([7, 30, 2, 2]),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first.rows.map((r) => r.rowId)).toEqual([2, 7, 30]);
    expect(second.rows.map((r) => r.rowId)).toEqual([2, 7, 30]);
  });

  it('orders the slots of a search by name, whatever their keys', async () => {
    const urls: URL[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      urls.push(new URL(String(input)));
      return json({ version: V, schema: S, results: [] });
    };
    const c = createXivapiClient({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });
    // Legs has the smaller key (1) but sorts after Body (328041).
    await c.searchItems([{ slot: 'Legs', base: 1, variant: 0 }, body]);
    expect(urls[0]?.searchParams.get('query')).toBe(
      '+((+EquipSlotCategory.Body=1 +ModelMain=328041) (+EquipSlotCategory.Legs=1 +ModelMain=1))',
    );
  });

  it('shares a request between two ring slots that hold the same model, in either order', async () => {
    const fetch = vi.fn(async () =>
      json({ version: V, schema: S, results: [] }),
    );
    const c = createXivapiClient({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });
    const left: EquipmentModel = { slot: 'LeftRing', base: 50, variant: 1 };
    const right: EquipmentModel = { slot: 'RightRing', base: 50, variant: 1 };
    await Promise.all([
      c.searchItems([left, right]),
      c.searchItems([right, left]),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('what the languages and the cache hold', () => {
  const withLanguages = (languages: unknown): XivapiOptions =>
    ({ languages }) as unknown as XivapiOptions;
  const invalid = expect.objectContaining({
    name: 'XivapiInputError',
    code: 'INVALID_OPTIONS',
  });
  const creators = [
    createDyeNameResolver,
    createXivapiClient,
    createXivapiResolver,
  ];
  it('refuses a list of languages with a hole, with every entry point', () => {
    // biome-ignore lint/suspicious/noSparseArray: the case under test
    const holes = ['en', , 'de'] as unknown as readonly Language[];
    const empty = new Array(1) as unknown as readonly Language[];
    for (const languages of [holes, empty])
      for (const create of creators)
        expect(() => create(withLanguages(languages))).toThrow(invalid);
  });

  it('refuses a list of languages whose element or length is a getter that throws', () => {
    const element = Object.defineProperty(['en'], 0, {
      get() {
        throw new Error('boom');
      },
    });
    const length = new Proxy(['en'], {
      get(target, key, receiver) {
        if (key === 'length') throw new Error('boom');
        return Reflect.get(target, key, receiver);
      },
    });
    for (const languages of [element, length])
      for (const create of creators)
        expect(() => create(withLanguages(languages))).toThrow(invalid);
  });

  const BAD_CACHES: [string, unknown][] = [
    ['no methods', {}],
    ['no set', { get: async () => null }],
    ['no get', { set: async () => {} }],
    ['a get that is not a function', { get: 'x', set: async () => {} }],
    ['a set that is not a function', { get: async () => null, set: 1 }],
  ];
  it.each(BAD_CACHES)(
    'refuses a cache with %s, with every entry point',
    (_name, cache) => {
      for (const create of creators)
        expect(() => create({ cache: cache as never })).toThrow(invalid);
    },
  );

  it('reads each language once, and refuses a list that is too long without reading it', () => {
    const reads: string[] = [];
    const watched = new Proxy(['en', 'de'], {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^[0-9]+$/.test(key)) reads.push(key);
        return Reflect.get(target, key, receiver);
      },
    });
    createXivapiClient(withLanguages(watched));
    expect(reads).toEqual(['0', '1']);
    const touched: string[] = [];
    const long = new Proxy(new Array(1_000_000_000), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^[0-9]+$/.test(key)) touched.push(key);
        return Reflect.get(target, key, receiver);
      },
    });
    expect(() => createXivapiClient(withLanguages(long))).toThrow(invalid);
    // The length is checked first: no element of a list that long is read.
    expect(touched).toEqual([]);
  });

  it('reads the length of a list of languages once, and refuses more than four before reading an element', () => {
    const indexReads: string[] = [];
    let lengthReads = 0;
    // The answers to successive reads of length: a list that changes its mind is read as it first said.
    const watch = (values: unknown[], lengths: number[]) =>
      new Proxy(values, {
        get(target, key, receiver) {
          if (key === 'length')
            return lengths[Math.min(lengthReads++, lengths.length - 1)];
          if (typeof key === 'string' && /^[0-9]+$/.test(key))
            indexReads.push(key);
          return Reflect.get(target, key, receiver);
        },
      });
    createXivapiClient(withLanguages(watch(['en', 'de'], [2, 1_000_000_000])));
    expect(lengthReads).toBe(1);
    expect(indexReads).toEqual(['0', '1']);
    indexReads.length = 0;
    expect(() =>
      createXivapiClient(
        withLanguages(watch(['en', 'de', 'fr', 'ja', 'en'], [5])),
      ),
    ).toThrow(invalid);
    expect(indexReads).toEqual([]);
    // Four are the most there are, and are accepted.
    expect(() =>
      createXivapiClient(withLanguages(['en', 'ja', 'de', 'fr'])),
    ).not.toThrow();
  });

  it.each([
    ['a string', 'en'],
    ['a Set', new Set(['en'])],
    ['an array-like object', { 0: 'en', length: 1 }],
    ['an empty list', []],
    ['a number', 1],
    ['an object', {}],
  ])(
    'refuses %s as the languages, with every entry point',
    (_name, languages) => {
      for (const create of creators)
        expect(() => create(withLanguages(languages))).toThrow(invalid);
    },
  );

  it('calls the methods of the cache on the cache, which may rely on this', async () => {
    class Store {
      readonly kept = new Map<string, unknown>();
      async get(key: string) {
        return (this.kept.get(key) ?? null) as never;
      }
      async set(key: string, value: unknown) {
        this.kept.set(key, value);
      }
    }
    const store = new Store();
    const fetch = vi.fn(async () =>
      json({ version: V, schema: S, results: [] }),
    );
    const client = createXivapiClient({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
      cache: store as never,
    });
    await client.searchItems([body]);
    await client.searchItems([body]);
    expect(store.kept.size).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads the two methods of the cache once, and calls them on the cache', async () => {
    const reads = { get: 0, set: 0 };
    class Store {
      readonly kept = new Map<string, unknown>();
      get get() {
        reads.get++;
        return async (key: string) => (this.kept.get(key) ?? null) as never;
      }
      get set() {
        reads.set++;
        return async (key: string, value: unknown) => {
          this.kept.set(key, value);
        };
      }
    }
    const store = new Store();
    const fetch = vi.fn(async () =>
      json({ version: V, schema: S, results: [] }),
    );
    const client = createXivapiClient({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
      cache: store as never,
    });
    await client.searchItems([body]);
    await client.searchItems([body]);
    expect(reads).toEqual({ get: 1, set: 1 });
    expect(store.kept.size).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('an option whose getter throws', () => {
  it('is INVALID_OPTIONS when it is a method of the cache that has the getter', () => {
    for (const method of ['get', 'set']) {
      const cache = Object.defineProperty(
        { get: async () => null, set: async () => {} },
        method,
        {
          enumerable: true,
          get() {
            throw new Error('boom');
          },
        },
      );
      expect(() =>
        createXivapiClient({ cache } as unknown as XivapiOptions),
      ).toThrow(
        expect.objectContaining({
          name: 'XivapiInputError',
          code: 'INVALID_OPTIONS',
        }),
      );
    }
  });

  const KEYS = [
    'fetch',
    'baseUrl',
    'version',
    'schema',
    'languages',
    'maxPages',
    'timeoutMs',
    'cache',
  ] as const;
  const hostile = (key: string): XivapiOptions =>
    Object.defineProperty({}, key, {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    }) as XivapiOptions;
  const invalid = expect.objectContaining({
    name: 'XivapiInputError',
    code: 'INVALID_OPTIONS',
  });

  const VALID: Record<(typeof KEYS)[number], unknown> = {
    fetch: async () => new Response('{}'),
    baseUrl: 'https://example.test/api',
    version: V,
    schema: S,
    languages: ['en'],
    maxPages: 5,
    timeoutMs: 1000,
    cache: createMemoryCache(),
  };
  it.each(KEYS)('is read once, whether it has a value or not: %s', (key) => {
    for (const create of [createXivapiClient, createXivapiResolver]) {
      let reads = 0;
      const options = Object.defineProperty({}, key, {
        enumerable: true,
        get() {
          reads++;
          return VALID[key];
        },
      });
      create(options as XivapiOptions);
      expect(reads).toBe(1);
    }
  });

  it.each(KEYS)('is read once by the client and the resolver: %s', (key) => {
    for (const create of [createXivapiClient, createXivapiResolver]) {
      let reads = 0;
      const options = Object.defineProperty({}, key, {
        enumerable: true,
        get() {
          reads++;
          return undefined;
        },
      });
      create(options as XivapiOptions);
      expect(reads).toBe(1);
    }
  });

  it.each(KEYS)(
    'is INVALID_OPTIONS for the dye resolver, the client and the resolver: %s',
    (key) => {
      expect(() => createDyeNameResolver(hostile(key))).toThrow(invalid);
      expect(() => createXivapiClient(hostile(key))).toThrow(invalid);
      expect(() => createXivapiResolver(hostile(key))).toThrow(invalid);
    },
  );
});
