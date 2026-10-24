import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDyeNameResolver } from '../src/dyes/index.js';
import { createMemoryCache, createXivapiClient } from '../src/xivapi/index.js';

const V = '0123456789abcdef';
const S = `exdschema@2:rev:${'a'.repeat(40)}`;
const row = (id: number, name: unknown = 'Synthetic grey') => ({
  row_id: id,
  fields: { 'Name@lang(en)': name },
});
const response = (rows: unknown[], version = V, schema = S) =>
  new Response(JSON.stringify({ rows, version, schema }));
afterEach(() => vi.useRealTimers());

describe('cached optional dye-name lookup', () => {
  it('captures caller IDs before queued work starts', async () => {
    const pending: ((r: Response) => void)[] = [];
    const urls: URL[] = [];
    const fetch: typeof globalThis.fetch = (input) => {
      urls.push(new URL(String(input)));
      return new Promise((resolve) => {
        pending.push(resolve);
      });
    };
    const resolver = createDyeNameResolver({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });
    const first = resolver.resolve([1]);
    const second = resolver.resolve([2]);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    const ids = [10, 3];
    const queued = resolver.resolve(ids);
    ids.splice(0, ids.length, 99);
    pending[0]?.(response([row(1)]));
    pending[1]?.(response([row(2)]));
    await vi.waitFor(() => expect(urls).toHaveLength(3));
    expect(urls[2]?.searchParams.get('rows')).toBe('3,10');
    pending[2]?.(response([row(3), row(10)]));
    await Promise.all([first, second, queued]);
  });
  it('is inert on import/construction and resolves empty input without fetching', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const resolver = createDyeNameResolver({ fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(await resolver.resolve([])).toMatchObject({
      status: 'complete',
      rows: [],
      version: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requests only sorted unique Stain IDs and localized names without credentials', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response([
        {
          row_id: 3,
          fields: {
            'Name@lang(en)': ' Synthetic grey ',
            'Name@lang(ja)': 'テスト',
          },
        },
      ]),
    );
    const result = await createDyeNameResolver({
      fetch,
      version: V,
      schema: S,
      languages: ['ja', 'en'],
    }).resolve([10, 3, 3]);
    const call = fetch.mock.calls[0];
    if (!call) throw new Error('Expected a request.');
    const [input, init] = call;
    const url = new URL(String(input));
    expect(url.pathname).toBe('/api/sheet/Stain');
    expect(url.searchParams.get('rows')).toBe('3,10');
    expect(url.searchParams.get('fields')).toBe('Name@lang(en),Name@lang(ja)');
    expect(url.searchParams.get('version')).toBe(V);
    expect(url.searchParams.get('schema')).toBe(S);
    expect(init).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'manual',
    });
    expect(result).toMatchObject({
      status: 'complete',
      rows: [{ rowId: 3, names: { en: 'Synthetic grey', ja: 'テスト' } }],
      version: V,
      schema: S,
    });
    expect(Object.keys(result.rows[0] ?? {})).toEqual(['rowId', 'names']);
  });
  it('caches successful requests by default and detaches returned results', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => response([row(3)]));
    const resolver = createDyeNameResolver({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });
    const first = await resolver.resolve([3]);
    const cached = first.rows[0];
    if (!cached) throw new Error('Expected a row.');
    cached.names.en = 'changed';
    expect((await resolver.resolve([3, 3])).rows[0]?.names.en).toBe(
      'Synthetic grey',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('separates language/schema cache namespaces across resolver instances', async () => {
    const cache = createMemoryCache();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input) => {
        const url = new URL(String(input));
        const lang = url.searchParams.get('fields')?.includes('(ja)')
          ? 'ja'
          : 'en';
        return response(
          [{ row_id: 3, fields: { [`Name@lang(${lang})`]: 'Synthetic' } }],
          V,
          url.searchParams.get('schema') ?? '',
        );
      });
    for (const [language, schema] of [
      ['en', S],
      ['en', S],
      ['ja', S],
      ['en', `exdschema@2:rev:${'b'.repeat(40)}`],
    ] as const)
      await createDyeNameResolver({
        fetch,
        cache,
        version: V,
        schema,
        languages: [language],
      }).resolve([3]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('expires positive cache entries', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => response([row(3)]));
    const resolver = createDyeNameResolver({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });
    await resolver.resolve([3]);
    vi.advanceTimersByTime(7 * 86400_000 + 1);
    await resolver.resolve([3]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('retains blank rows and accepts a non-conforming 200 that leaves out a requested row', async () => {
    const resolver = createDyeNameResolver({
      version: V,
      schema: S,
      languages: ['en'],
      fetch: async () => response([row(0, 'No Color'), row(126, '')]),
    });
    expect(await resolver.resolve([0, 126, 65535])).toMatchObject({
      status: 'complete',
      rows: [
        { rowId: 0, names: { en: 'No Color' } },
        { rowId: 126, names: { en: '' } },
      ],
    });
  });
  it.each([-1, 65536, 1.5, NaN, '3', null, {}, true])(
    'rejects invalid ID %j before I/O',
    async (id) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      await expect(
        createDyeNameResolver({ fetch }).resolve([id as number]),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('bounds the batch and does not run coercion hooks', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const resolver = createDyeNameResolver({ fetch });
    await expect(
      resolver.resolve(Array.from({ length: 65 }, (_, i) => i)),
    ).rejects.toThrow();
    await expect(resolver.resolve(new Array<number>(2))).rejects.toThrow();
    const coerce = vi.fn(() => 3);
    await expect(
      resolver.resolve([{ valueOf: coerce } as unknown as number]),
    ).rejects.toThrow();
    expect(coerce).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(
    [
      [row(4)],
      [row(3, 123)],
      [{ row_id: 3, fields: {} }],
      [{ ...row(3), sheet: 'Item' }],
      [row(3, 'a'.repeat(1025))],
    ].map((rows) => ({ rows })),
  )(
    'rejects unrelated or malformed rows without caching them',
    async ({ rows }) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async () => response(rows));
      const resolver = createDyeNameResolver({
        fetch,
        version: V,
        schema: S,
        languages: ['en'],
      });
      expect((await resolver.resolve([3])).status).toBe('unavailable');
      await resolver.resolve([3]);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
  it('rejects identity drift', async () => {
    const result = await createDyeNameResolver({
      version: V,
      schema: S,
      languages: ['en'],
      fetch: async () => response([row(3)], 'fedcba9876543210'),
    }).resolve([3]);
    expect(result.status).toBe('unavailable');
    expect(result.issues.map((issue) => issue.code)).toContain(
      'RESPONSE_IDENTITY',
    );
  });
  it('treats conflicting rows as partial and does not cache them', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () =>
        response([row(3, 'First'), row(3, 'Second')]),
      );
    const resolver = createDyeNameResolver({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });
    expect((await resolver.resolve([3])).status).toBe('partial');
    await resolver.resolve([3]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('revalidates host cache values and rejects unrelated cached rows', async () => {
    const cache = createMemoryCache();
    const poisoned = {
      async get(key: string) {
        const value = await cache.get(key);
        if (value) value.rows = [{ rowId: 4, names: { en: 'Wrong ID' } }];
        return value;
      },
      set: cache.set,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => response([row(3)]));
    const resolver = createDyeNameResolver({
      fetch,
      cache: poisoned,
      version: V,
      schema: S,
      languages: ['en'],
    });
    await resolver.resolve([3]);
    expect((await resolver.resolve([3])).rows[0]?.rowId).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('bounds uncooperative requests with a timeout', async () => {
    vi.useFakeTimers();
    const resolver = createDyeNameResolver({
      version: V,
      schema: S,
      timeoutMs: 10,
      fetch: () => new Promise(() => {}),
    });
    const pending = resolver.resolve([3]);
    await vi.advanceTimersByTimeAsync(11);
    expect((await pending).issues.map((issue) => issue.code)).toContain(
      'TIMEOUT',
    );
  });
  it('rejects oversized responses', async () => {
    const result = await createDyeNameResolver({
      version: V,
      schema: S,
      fetch: async () => new Response(' '.repeat(2 * 1024 * 1024 + 1)),
    }).resolve([3]);
    expect(result.status).toBe('unavailable');
    expect(result.issues.map((issue) => issue.code)).toContain(
      'RESPONSE_LIMIT',
    );
  });
  it('does not mistake unexpected pagination for a complete cacheable batch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            version: V,
            schema: S,
            rows: [row(3)],
            next: 'more',
          }),
        ),
    );
    const resolver = createDyeNameResolver({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });
    expect((await resolver.resolve([3])).status).toBe('partial');
    await resolver.resolve([3]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not cache network failures', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('private details'));
    const resolver = createDyeNameResolver({ fetch, version: V, schema: S });
    expect((await resolver.resolve([3])).status).toBe('unavailable');
    await resolver.resolve([3]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('coalesces equivalent in-flight batches and keeps subscriber cancellation independent', async () => {
    let finish!: (r: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const resolver = createDyeNameResolver({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });
    const control = new AbortController();
    const first = resolver.resolve([3], { signal: control.signal });
    const second = resolver.resolve([3]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    control.abort();
    expect((await first).status).toBe('cancelled');
    finish(response([row(3)]));
    expect((await second).status).toBe('complete');
  });
});

// The live API answers a row list that names a missing row with HTTP 404 and the first
// missing row (checked 2026-10-23); it never returns a 200 that silently omits the row.
const missingRow = (sheet: string, id: number) =>
  new Response(
    JSON.stringify({
      code: 404,
      message: `not found: the Excel row ${sheet}/${id}:0 could not be found`,
    }),
    { status: 404 },
  );
const stainApi =
  (existing: readonly number[], urls: URL[] = []): typeof globalThis.fetch =>
  async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    const ids = (url.searchParams.get('rows') ?? '').split(',').map(Number);
    const gap = ids.find((id) => !existing.includes(id));
    return gap === undefined
      ? response(ids.map((id) => row(id, `Dye ${id}`)))
      : missingRow('Stain', gap);
  };
const dyes = (fetch: typeof globalThis.fetch, extra = {}) =>
  createDyeNameResolver({
    fetch,
    version: V,
    schema: S,
    languages: ['en'],
    ...extra,
  });

describe('rows that XIVAPI reports as missing', () => {
  it('drops each missing Stain row and still names the others', async () => {
    const urls: URL[] = [];
    const result = await dyes(stainApi([0, 3], urls)).resolve([201, 3, 0, 200]);
    expect(urls.map((url) => url.searchParams.get('rows'))).toEqual([
      '0,3,200,201',
      '0,3,201',
      '0,3',
    ]);
    expect(result).toMatchObject({
      status: 'complete',
      version: V,
      schema: S,
      issues: [],
    });
    expect(result.rows.map((r) => r.rowId)).toEqual([0, 3]);
  });
  it('reports a request whose rows are all missing as complete and empty, and caches it', async () => {
    const urls: URL[] = [];
    const resolver = dyes(stainApi([0], urls));
    expect(await resolver.resolve([200])).toMatchObject({
      status: 'complete',
      rows: [],
      version: V,
      schema: S,
    });
    await resolver.resolve([200]);
    expect(urls).toHaveLength(1);
  });
  it.each([
    [
      'a missing sheet',
      'not found: the Excel sheet "Stain" could not be found',
    ],
    [
      'a different sheet',
      'not found: the Excel row Item/3:0 could not be found',
    ],
    [
      'a row that was not requested',
      'not found: the Excel row Stain/77:0 could not be found',
    ],
    ['an unrecognised message', 'something else entirely'],
    [
      'a row id with leading zeros',
      'not found: the Excel row Stain/003:0 could not be found',
    ],
    [
      'a non-zero subrow',
      'not found: the Excel row Stain/3:7 could not be found',
    ],
  ])('still fails closed on a 404 naming %s', async (_name, message) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ code: 404, message }), { status: 404 }),
      );
    const result = await dyes(fetch).resolve([3]);
    expect(result.status).toBe('unavailable');
    expect(result.issues.map((issue) => issue.code)).toContain(
      'UPSTREAM_UNAVAILABLE',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  const matching = (extra = {}) =>
    JSON.stringify({
      code: 404,
      message: 'not found: the Excel row Stain/3:0 could not be found',
      ...extra,
    });
  it.each([
    ['not JSON', 'not json at all'],
    [
      'over 4 KiB although the message matches',
      matching({ pad: 'x'.repeat(5000) }),
    ],
    ['carrying another code', matching({ code: 500 })],
  ])('does not trust a 404 body that is %s', async (_name, text) => {
    const result = await dyes(
      async () => new Response(text, { status: 404 }),
    ).resolve([3]);
    expect(result.status).toBe('unavailable');
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'UPSTREAM_UNAVAILABLE',
    ]);
  });
  it.each([400, 410, 500])(
    'does not take a status-%i answer for a missing row',
    async (status) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response(matching(), { status }),
      );
      const result = await dyes(fetch).resolve([3]);
      expect(result.status).toBe('unavailable');
      expect(result.issues.map((issue) => issue.code)).toContain(
        'UPSTREAM_UNAVAILABLE',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('leaves the schema null when every row is missing and the schema is not pinned', async () => {
    const paths: string[] = [];
    const resolver = createDyeNameResolver({
      languages: ['en'],
      fetch: async (input) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        return url.pathname.endsWith('/version')
          ? new Response(
              JSON.stringify({ versions: [{ key: V, names: ['latest'] }] }),
            )
          : missingRow('Stain', 200);
      },
    });
    expect(await resolver.resolve([200])).toMatchObject({
      status: 'complete',
      rows: [],
      version: V,
      schema: null,
    });
    // Without both identities the empty answer is not cached, so asking again asks again.
    await resolver.resolve([200]);
    expect(paths).toEqual([
      '/api/version',
      '/api/sheet/Stain',
      '/api/sheet/Stain',
    ]);
  });
  it('does not drop rows while the version alias is unresolved', async () => {
    // A 404 names no version, so with 'latest' unresolved a later 200 could describe another one.
    const urls: URL[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      return url.pathname.endsWith('/version')
        ? new Response('{}', { status: 500 })
        : missingRow('Stain', 200);
    };
    const result = await createDyeNameResolver({
      fetch,
      schema: S,
      languages: ['en'],
    }).resolve([2, 200]);
    expect(result.status).toBe('unavailable');
    expect(result.issues.map((issue) => issue.code)).toContain(
      'UPSTREAM_UNAVAILABLE',
    );
    expect(urls.map((url) => url.pathname)).toEqual([
      '/api/version',
      '/api/sheet/Stain',
    ]);
  });
  it('flags a dropped row that comes back in the later answer', async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () =>
      ++calls === 1
        ? missingRow('Stain', 200)
        : response([row(2), row(3), row(200)]);
    const result = await dyes(fetch).resolve([2, 3, 200]);
    expect(calls).toBe(2);
    expect(result.status).toBe('partial');
    expect(result.rows.map((r) => r.rowId)).toEqual([2, 3]);
    expect(result.issues.map((issue) => issue.code)).toContain('INVALID_ROW');
  });
  it('stays inside the request budget when every row is missing', async () => {
    const urls: URL[] = [];
    const result = await dyes(stainApi([], urls)).resolve(
      Array.from({ length: 64 }, (_, i) => 100 + i),
    );
    expect(urls).toHaveLength(40);
    expect(result.status).toBe('unavailable');
    expect(result.issues.map((issue) => issue.code)).toContain('REQUEST_LIMIT');
  });
});

describe('host option objects that are not plain literals', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('unexpected global fetch');
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('reads an inherited base URL and rejects an inherited invalid maxPages', async () => {
    const urls: URL[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      urls.push(new URL(String(input)));
      return response([row(3)]);
    };
    await createDyeNameResolver(
      Object.create({
        fetch,
        baseUrl: 'https://example.test/api',
        version: V,
        schema: S,
        languages: ['en'],
      }),
    ).resolve([3]);
    expect(urls.map((url) => url.origin)).toEqual(['https://example.test']);
    expect(() =>
      createDyeNameResolver(Object.create({ maxPages: 0 })),
    ).toThrow();
  });
  const make = () => {
    const urls: URL[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      urls.push(new URL(String(input)));
      return response([row(3)]);
    };
    return { urls, fetch };
  };
  it.each([
    [
      'a class with getters',
      (fetch: typeof globalThis.fetch) =>
        new (class {
          get fetch() {
            return fetch;
          }
          get version() {
            return V;
          }
          get schema() {
            return S;
          }
          get languages() {
            return ['en' as const];
          }
        })(),
    ],
    [
      'inherited options',
      (fetch: typeof globalThis.fetch) =>
        Object.create({ fetch, version: V, schema: S, languages: ['en'] }),
    ],
    [
      'non-enumerable options',
      (fetch: typeof globalThis.fetch) =>
        Object.defineProperties(
          {},
          {
            fetch: { value: fetch },
            version: { value: V },
            schema: { value: S },
            languages: { value: ['en'] },
          },
        ),
    ],
  ])('reads %s the way the client does', async (_name, options) => {
    const { urls, fetch } = make();
    const config = options(fetch);
    const viaDyes = await createDyeNameResolver(config).resolve([3]);
    const viaClient = await createXivapiClient(config).getStains([3]);
    expect(viaDyes).toMatchObject({
      status: 'complete',
      version: V,
      schema: S,
    });
    expect(viaClient.rows).toEqual(viaDyes.rows);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url.searchParams.get('version')).toBe(V);
      expect(url.searchParams.get('fields')).toBe('Name@lang(en)');
    }
  });
  it('rejects an option getter that throws with the same error as the client', () => {
    const config = Object.defineProperty({}, 'baseUrl', {
      get() {
        throw new Error('boom');
      },
    });
    expect(() => createDyeNameResolver(config)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTIONS' }),
    );
    expect(() => createXivapiClient(config)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTIONS' }),
    );
  });
  it('still rejects a null cache and a non-object', () => {
    expect(() => createDyeNameResolver({ cache: null } as never)).toThrow();
    expect(() => createDyeNameResolver(null as never)).toThrow();
  });
});
