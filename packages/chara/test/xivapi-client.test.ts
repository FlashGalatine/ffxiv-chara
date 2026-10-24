import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EquipmentModel } from '../src/types.js';
import {
  type CachedRows,
  createMemoryCache,
  createXivapiClient,
  type ResolutionCache,
  type XivapiOptions,
} from '../src/xivapi/index.js';

const V = '0123456789abcdef';
const V2 = 'fedcba9876543210';
const S = `exdschema@2:rev:${'a'.repeat(40)}`;
const body: EquipmentModel = { slot: 'Body', base: 361, variant: 5 };
const weapon: EquipmentModel = {
  slot: 'MainHand',
  set: 634,
  base: 19,
  variant: 1,
};
const wire = (rowId = 42, key = 328041, slot = 'Body') => ({
  sheet: 'Item',
  row_id: rowId,
  fields: {
    'Name@lang(en)': 'Example',
    'Name@lang(ja)': '例',
    Icon: { id: 123 },
    ModelMain: key,
    ModelSub: 0,
    EquipSlotCategory: { fields: { [slot]: 1 } },
    DyeCount: 2,
    IsGlamorous: true,
  },
});
const page = (
  results: unknown[] = [],
  next?: unknown,
  version = V,
  schema = S,
) => ({ version, schema, results, ...(next !== undefined ? { next } : {}) });
const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(data), {
    status,
    ...(headers ? { headers } : {}),
  });
const client = (fetch: typeof globalThis.fetch, options: XivapiOptions = {}) =>
  createXivapiClient({ fetch, version: V, schema: S, ...options });
const code = (result: { issues: { code: string }[] }) =>
  result.issues.map((i) => i.code);
afterEach(() => vi.useRealTimers());

describe('portable XIVAPI requests', () => {
  it('does not treat arbitrary glasses 404s as a successful empty lookup', async () => {
    const r = await client(
      async () => new Response('Not a valid version', { status: 404 }),
    ).getGlasses(8);
    expect(r.status).toBe('unavailable');
  });
  it('encodes grouped decimal keys, deduplicates models and minimizes requests', async () => {
    let seen: URL | undefined;
    let init: RequestInit | undefined;
    const c = client(
      async (url, options) => {
        seen = new URL(String(url));
        init = options;
        return json(page([wire()]));
      },
      { languages: ['ja', 'en'] },
    );
    const result = await c.searchItems([
      { ...body, Author: 'PRIVATE', Dye: 99 } as EquipmentModel,
      weapon,
      body,
    ]);
    expect(result.status).toBe('complete');
    expect(result.rows[0]?.rowId).toBe(42);
    expect(seen?.origin).toBe('https://v2.xivapi.com');
    expect(seen?.searchParams.get('query')).toBe(
      '+((+EquipSlotCategory.Body=1 +ModelMain=328041) (+EquipSlotCategory.MainHand=1 +ModelMain=4296213114))',
    );
    expect(seen?.searchParams.get('fields')).toContain('Name@lang(ja)');
    expect(seen?.searchParams.get('version')).toBe(V);
    expect(seen?.searchParams.get('schema')).toBe(S);
    expect(seen?.href).not.toMatch(/PRIVATE|Author|Dye=|99/);
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'manual',
    });
    expect(new Headers(init?.headers).has('User-Agent')).toBe(false);
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });
  it('continues opaque cursors on the fixed endpoint and resends fields', async () => {
    const urls: URL[] = [];
    const c = client(async (url) => {
      const u = new URL(String(url));
      urls.push(u);
      return json(
        urls.length === 1
          ? page([wire()], 'https://evil.invalid/?a=1')
          : page([wire(43)]),
      );
    });
    const r = await c.searchItems([body]);
    expect(r.status).toBe('complete');
    expect(r.rows.map((x) => x.rowId)).toEqual([42, 43]);
    expect(urls[1]?.searchParams.get('cursor')).toBe(
      'https://evil.invalid/?a=1',
    );
    expect(urls[1]?.origin).toBe(urls[0]?.origin);
    expect(urls[1]?.searchParams.get('fields')).toBe(
      urls[0]?.searchParams.get('fields'),
    );
  });
  it.each(['pages', 'repeat', 'malformed', 'version', 'schema'])(
    'preserves partial rows on %s failure',
    async (failure) => {
      let calls = 0;
      const c = client(
        async () => {
          calls++;
          return calls === 1
            ? json(page([wire()], 'next'))
            : failure === 'malformed'
              ? new Response('{PRIVATE')
              : json(
                  page(
                    [],
                    failure === 'repeat' ? 'next' : undefined,
                    failure === 'version' ? V2 : V,
                    failure === 'schema' ? 'bad' : S,
                  ),
                );
        },
        { maxPages: failure === 'pages' ? 1 : 20 },
      );
      const r = await c.searchItems([body]);
      expect(r.status).toBe('partial');
      expect(r.rows).toHaveLength(1);
      expect(r.issues.length).toBeGreaterThan(0);
      expect(JSON.stringify(r.issues)).not.toContain('PRIVATE');
    },
  );
  it('marks malformed and unassociated rows incomplete while retaining valid rows', async () => {
    const r = await client(async () =>
      json(page([wire(), wire(44, 1), { row_id: -1, fields: {} }])),
    ).searchItems([body]);
    expect(r.status).toBe('partial');
    expect(r.rows.map((x) => x.rowId)).toEqual([42]);
  });
  it('keeps missing rules unknown and returns facewear separately', async () => {
    const r = await client(async () => json(page([wire()]))).searchItems([
      body,
    ]);
    expect(r.rows[0]?.rules).toMatchObject({
      dyeCount: 2,
      glamourable: true,
      grandCompany: null,
      wear: {},
    });
    const g = await client(async () =>
      json({
        version: V,
        schema: S,
        rows: [{ row_id: 8, fields: { 'Name@lang(en)': 'Glasses' } }],
      }),
    ).getGlasses(8);
    expect(g.status).toBe('complete');
    expect(g.rows[0]).toEqual({
      rowId: 8,
      names: { en: 'Glasses' },
      iconId: null,
    });
  });
  it('treats a validated successful empty search or glasses row list as complete empty, and an unrecognised failure as unavailable', async () => {
    expect(
      (await client(async () => json(page())).searchItems([body])).status,
    ).toBe('complete');
    expect(
      (
        await client(async () =>
          json({ version: V, schema: S, rows: [] }),
        ).getGlasses(8)
      ).status,
    ).toBe('complete');
    expect(
      (await client(async () => json({}, 500)).searchItems([body])).status,
    ).toBe('unavailable');
  });
  it.each([
    { baseUrl: 'http://example.com/api' },
    { baseUrl: 'https://user:pass@example.com/api' },
    { baseUrl: 'https://example.com/api#x' },
    { baseUrl: 'https://example.com/api?x=y' },
    { version: '+ModelMain=1' },
    { schema: 'evil()' },
    { languages: ['kr'] },
    { maxPages: NaN },
    { maxPages: 21 },
    { timeoutMs: Infinity },
  ])('rejects invalid host options before I/O %j', (options) => {
    expect(() => createXivapiClient(options as XivapiOptions)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTIONS' }),
    );
  });
  it('validates direct models, duplicates by slot, glasses and input bounds before I/O', async () => {
    const c = client(async () => {
      throw new Error('must not fetch');
    });
    for (const models of [
      [{ ...body, base: -1 }],
      [body, { ...body, variant: 6 }],
      Array(100).fill(body),
    ])
      await expect(c.searchItems(models)).rejects.toMatchObject({
        code: 'INVALID_LOOKUP',
      });
    await expect(c.getGlasses(65536)).rejects.toMatchObject({
      code: 'INVALID_LOOKUP',
    });
    expect((await c.searchItems([])).status).toBe('complete');
  });
});

describe('bounded transport and shared work', () => {
  it('applies ordinary string limits to API image-named fields', async () => {
    const r = await client(async () =>
      json({ ...page(), Base64Image: 'x'.repeat(65_537) }),
    ).searchItems([body]);
    expect(code(r)).toContain('MALFORMED_RESPONSE');
  });
  it('uses the whole-operation deadline across successful pages and retry backoff', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = client(async () => {
      await new Promise((resolve) => setTimeout(resolve, 8000));
      return json(page([wire()], String(++calls)));
    }).searchItems([body]);
    await vi.advanceTimersByTimeAsync(30_000);
    const r = await p;
    expect(r.status).toBe('partial');
    expect(code(r)).toContain('DEADLINE');
    expect(calls).toBe(3);
  });
  it('counts duplicate encountered rows toward the operation row budget', async () => {
    let calls = 0;
    const r = await client(async () =>
      json(page(Array(500).fill(wire()), String(++calls))),
    ).searchItems([body]);
    expect(r.status).toBe('partial');
    expect(code(r)).toContain('ROW_LIMIT');
    expect(calls).toBe(11);
    expect(r.rows).toHaveLength(1);
  });
  it('counts error bodies and retries toward the aggregate byte and request budgets', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const padding = Object.fromEntries(
      Array.from({ length: 24 }, (_, i) => [String(i), 'x'.repeat(60_000)]),
    );
    const p = client(async () =>
      ++calls % 2
        ? json(padding, 503)
        : json({ ...page([wire()], String(calls)), padding }),
    ).searchItems([body]);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.status).toBe('partial');
    expect(code(r)).toContain('RESPONSE_LIMIT');
    expect(calls).toBe(8);
    calls = 0;
    const q = createXivapiClient({
      schema: S,
      fetch: async (url) => {
        if (String(url).includes('/version'))
          return json({ versions: [{ key: V, names: ['latest'] }] });
        return ++calls % 2
          ? json({}, 503)
          : json(page([wire()], String(calls)));
      },
    }).searchItems([body]);
    await vi.runAllTimersAsync();
    expect(code(await q)).toContain('REQUEST_LIMIT');
    expect(calls).toBe(39);
  });
  it('cancels retry backoff and queued operations without additional requests', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const abort = new AbortController();
    const c = client(async () => {
      calls++;
      return json({}, 503);
    });
    const p = c.searchItems([body], { signal: abort.signal });
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    expect((await p).status).toBe('cancelled');
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toBe(1);
    const blocked = client(async () => new Promise<Response>(() => {}));
    const first = blocked.getGlasses(1);
    const second = blocked.getGlasses(2);
    const queued = new AbortController();
    const last = blocked.getGlasses(3, { signal: queued.signal });
    queued.abort();
    expect((await last).status).toBe('cancelled');
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all([first, second]);
  });
  it.each([429, 503])(
    'retries %s once with bounded backoff',
    async (status) => {
      vi.useFakeTimers();
      let calls = 0;
      const p = client(async () =>
        ++calls === 1
          ? json({}, status, { 'Retry-After': '1' })
          : json(page([wire()])),
      ).searchItems([body]);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await p).status).toBe('complete');
      expect(calls).toBe(2);
    },
  );
  it('refuses long retries and redirects without exposing error payloads', async () => {
    for (const response of [
      json({ secret: 'PRIVATE' }, 429, { 'Retry-After': '999999' }),
      new Response('PRIVATE', {
        status: 302,
        headers: { Location: 'https://evil.invalid' },
      }),
    ]) {
      const r = await client(async () => response).searchItems([body]);
      expect(r.status).toBe('unavailable');
      expect(JSON.stringify(r)).not.toContain('PRIVATE');
    }
  });
  it('times out headers and stalled body reads even when injected fetch ignores abort', async () => {
    vi.useFakeTimers();
    for (const f of [
      async () => new Promise<Response>(() => {}),
      async () => new Response(new ReadableStream({ start() {} })),
    ]) {
      const p = client(f, { timeoutMs: 20 }).searchItems([body]);
      await vi.advanceTimersByTimeAsync(20);
      const r = await p;
      expect(r.status).toBe('unavailable');
      expect(code(r)).toContain('TIMEOUT');
    }
  });
  it('cancels one coalesced subscriber without cancelling another and detaches results', async () => {
    let finish: ((r: Response) => void) | undefined;
    let calls = 0;
    const c = client(async () => {
      calls++;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const abort = new AbortController();
    const p = c.searchItems([body], { signal: abort.signal });
    const q = c.searchItems([body]);
    await vi.waitFor(() => expect(finish).toBeDefined());
    abort.abort();
    expect((await p).status).toBe('cancelled');
    finish?.(json(page([wire()])));
    expect((await q).status).toBe('complete');
    expect(calls).toBe(1);
  });
  it('aborts shared transport when the last subscriber cancels', async () => {
    let signal: AbortSignal | null | undefined;
    const abort = new AbortController();
    const p = client(async (_u, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    }).searchItems([body], { signal: abort.signal });
    await vi.waitFor(() => expect(signal).toBeDefined());
    abort.abort();
    expect((await p).status).toBe('cancelled');
    expect(signal?.aborted).toBe(true);
  });
  it('caps concurrency, queue size and elapsed queued work', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const c = client(async () => {
      calls++;
      return new Promise<Response>(() => {});
    });
    const pending = Array.from({ length: 18 }, (_, i) => c.getGlasses(i + 1));
    const excess = await c.getGlasses(99);
    expect(code(excess)).toContain('QUEUE_FULL');
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(30_001);
    const results = await Promise.all(pending);
    expect(results.every((r) => r.status === 'unavailable')).toBe(true);
    expect(calls).toBeLessThanOrEqual(6);
  });
  it.each([
    '{"results":[],"results":[]}',
    '{"a":9007199254740993}',
    `${'['.repeat(33)}0${']'.repeat(33)}`,
    JSON.stringify({ a: 'x'.repeat(65_537) }),
    JSON.stringify(Array(100_001).fill(null)),
    JSON.stringify(page(Array(501).fill(wire()))),
    JSON.stringify(page([], 'x'.repeat(2049))),
  ])('rejects malformed or excessive API structures', async (raw) => {
    const r = await client(async () => new Response(raw)).searchItems([body]);
    expect(r.status).toBe('unavailable');
  });
  it('caps streamed bytes, cancels over-limit streams, and requires bounded body support', async () => {
    let cancelled = false;
    const r = await client(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    ).searchItems([body]);
    expect(code(r)).toContain('RESPONSE_LIMIT');
    expect(cancelled).toBe(true);
    const empty = await client(async () => new Response(null)).searchItems([
      body,
    ]);
    expect(code(empty)).toContain('BODY_UNAVAILABLE');
  });
});

describe('versioned normalized row caching', () => {
  it('accepts valid cache data with reordered object keys', async () => {
    const reorder = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reorder)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, child]) => [key, reorder(child)]),
            )
          : value;
    let stored: CachedRows | null = null;
    let calls = 0;
    const c = client(
      async () => {
        calls++;
        return json(page([wire()]));
      },
      {
        cache: {
          async get() {
            return stored;
          },
          async set(_key, value) {
            stored = reorder(value) as CachedRows;
          },
        },
      },
    );
    await c.searchItems([body]);
    expect((await c.searchItems([body])).rows[0]?.rowId).toBe(42);
    expect(calls).toBe(1);
  });
  it('admits a complete cache entry before cloning or invoking the cache writer', async () => {
    let calls = 0;
    let writes = 0;
    const c = client(
      async () => {
        const offset = calls++ * 500;
        return json(
          page(
            Array.from({ length: 500 }, (_, i) => wire(offset + i)),
            calls < 10 ? String(calls) : undefined,
          ),
        );
      },
      {
        cache: {
          async get() {
            return null;
          },
          async set() {
            writes++;
          },
        },
      },
    );
    const r = await c.searchItems([body]);
    expect(r.status).toBe('complete');
    expect(r.rows).toHaveLength(5000);
    expect(writes).toBe(0);
  });
  it('enforces the aggregate serialized memory capacity', async () => {
    const cache = createMemoryCache();
    const record = {
      format: 1,
      namespace: 'n',
      version: V,
      schema: S,
      complete: true,
      rows: [],
      padding: Array(100).fill('x'.repeat(60_000)),
    } as CachedRows;
    await cache.set('first', record, 1000);
    await cache.set('second', record, 1000);
    expect(await cache.get('first')).toBeNull();
    expect(await cache.get('second')).not.toBeNull();
  });
  it('does not execute accessors or nonenumerable serialization hooks in cache records', async () => {
    let executed = 0;
    const record = {
      format: 1,
      namespace: 'n',
      version: V,
      schema: S,
      complete: true,
      rows: [],
    };
    Object.defineProperty(record, 'toJSON', {
      value() {
        executed++;
        return {};
      },
    });
    const cache = createMemoryCache();
    await cache.set('hook', record as CachedRows, 1000);
    expect(executed).toBe(0);
    expect(await cache.get('hook')).toBeNull();
    const getter = Object.defineProperty({}, 'rows', {
      enumerable: true,
      get() {
        executed++;
        return [];
      },
    });
    await cache.set('getter', getter as CachedRows, 1000);
    expect(executed).toBe(0);
  });
  it('validates cached identity, association and completeness before trusting a hit', async () => {
    let writes: CachedRows | undefined;
    let calls = 0;
    const cache = {
      async get() {
        return writes ?? null;
      },
      async set(_key: string, record: CachedRows) {
        writes = record;
      },
    };
    const c = client(
      async () => {
        calls++;
        return json(page([wire()]));
      },
      { cache },
    );
    await c.searchItems([body]);
    expect(writes).toBeDefined();
    for (const mutate of [
      (v: CachedRows) => {
        v.namespace = 'wrong';
      },
      (v: CachedRows) => {
        v.version = V2;
      },
      (v: CachedRows) => {
        (v as { complete: boolean }).complete = false;
      },
      (v: CachedRows) => {
        (v.rows[0] as { modelMain: string }).modelMain = '1';
      },
      (v: CachedRows) => {
        const row = v.rows[0];
        if (!row) throw new Error('Expected cached row');
        row.names.en = 'x'.repeat(1025);
      },
    ]) {
      if (!writes) throw new Error('Expected cache write');
      mutate(writes);
      await c.searchItems([body]);
    }
    expect(calls).toBe(6);
  });
  it('isolates endpoint, locale, schema and model namespaces when sharing a cache', async () => {
    const cache = createMemoryCache();
    let calls = 0;
    const f: typeof globalThis.fetch = async () => {
      calls++;
      return json(page([wire()]));
    };
    for (const options of [
      {},
      { baseUrl: 'https://mirror.example/api' },
      { languages: ['en'] as const },
      { schema: `exdschema@2:rev:${'b'.repeat(40)}` },
    ]) {
      await client(f, { ...options, cache }).searchItems([body]);
    }
    expect(calls).toBe(4);
  });
  it('uses positive and empty TTLs and returns detached cache results', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const c = client(
      async () => {
        calls++;
        return json(page([wire()]));
      },
      { cache: createMemoryCache() },
    );
    const first = await c.searchItems([body]);
    const row = first.rows[0];
    if (!row) throw new Error('Expected row');
    row.names.en = 'POISON';
    expect((await c.searchItems([body])).rows[0]?.names.en).toBe('Example');
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(7 * 86400_000 + 1);
    await c.searchItems([body]);
    expect(calls).toBe(2);
    let misses = 0;
    const empty = client(
      async () => {
        misses++;
        return json(page());
      },
      { cache: createMemoryCache() },
    );
    await empty.searchItems([body]);
    await empty.searchItems([body]);
    expect(misses).toBe(1);
    await vi.advanceTimersByTimeAsync(600_001);
    await empty.searchItems([body]);
    expect(misses).toBe(2);
  });
  it('refreshes latest aliases and never reads previous-version entries after refresh failure', async () => {
    vi.useFakeTimers();
    let version = V;
    let fail = false;
    const versions: string[] = [];
    const c = createXivapiClient({
      schema: S,
      cache: createMemoryCache(),
      fetch: async (url) => {
        const u = new URL(String(url));
        if (u.pathname.endsWith('/version'))
          return fail
            ? json({}, 500)
            : json({ versions: [{ key: version, names: ['latest'] }] });
        versions.push(u.searchParams.get('version') ?? 'missing');
        return json(page([wire()], undefined, version));
      },
    });
    await c.searchItems([body]);
    await c.searchItems([body]);
    expect(versions).toEqual([V]);
    version = V2;
    await vi.advanceTimersByTimeAsync(600_001);
    await c.searchItems([body]);
    expect(versions).toEqual([V, V2]);
    fail = true;
    await vi.advanceTimersByTimeAsync(600_001);
    await c.searchItems([body]);
    expect(versions.at(-1)).toBe('latest');
  });
  it('never caches partial, failed, unknown-version data or unsafe cache shapes', async () => {
    let writes = 0;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const cache = {
      async get() {
        return cyclic as unknown as CachedRows;
      },
      async set() {
        writes++;
      },
    };
    const partial = client(async () => json(page([wire()], 'next')), {
      maxPages: 1,
      cache,
    });
    expect((await partial.searchItems([body])).status).toBe('partial');
    expect(writes).toBe(0);
    const unknown = client(async () => json(page([], undefined, 'latest')), {
      cache,
    });
    expect((await unknown.searchItems([body])).status).toBe('unavailable');
    expect(writes).toBe(0);
  });
  it('bounds memory cache entries, TTL and serialized size before copying', async () => {
    const cache = createMemoryCache();
    const record: CachedRows = {
      format: 1,
      namespace: 'n',
      version: V,
      schema: S,
      complete: true,
      rows: [],
    };
    for (let i = 0; i < 129; i++) await cache.set(String(i), record, 1000);
    expect(await cache.get('0')).toBeNull();
    expect(await cache.get('128')).toEqual(record);
    const cycle = { ...record } as CachedRows & { self?: unknown };
    cycle.self = cycle;
    await cache.set('cycle', cycle, 1000);
    expect(await cache.get('cycle')).toBeNull();
    await cache.set('bad', record, Infinity);
    expect(await cache.get('bad')).toBeNull();
  });
});

describe('browser-style redirects and cached row order', () => {
  it('reports an opaque redirect as a refused redirect, as a browser returns it', async () => {
    // fetch with redirect: 'manual' resolves to type opaqueredirect, status 0 and no body.
    const opaque = {
      type: 'opaqueredirect',
      status: 0,
      ok: false,
      body: null,
      headers: new Headers(),
    } as unknown as Response;
    const r = await client(async () => opaque).searchItems([body]);
    expect(r.status).toBe('unavailable');
    expect(code(r)).toEqual(['REDIRECT_REFUSED']);
  });
  it('still refuses a redirect whose body cannot be cancelled', async () => {
    const odd = {
      type: 'basic',
      status: 302,
      ok: false,
      body: {},
      headers: new Headers(),
    } as unknown as Response;
    const r = await client(async () => odd).searchItems([body]);
    expect(code(r)).toEqual(['REDIRECT_REFUSED']);
  });
  it('treats a cached entry with a repeated row as a miss', async () => {
    const backing = new Map<string, unknown>();
    const store = {
      async get(key: string) {
        return (backing.get(key) ?? null) as CachedRows | null;
      },
      async set(key: string, value: CachedRows) {
        backing.set(key, JSON.parse(JSON.stringify(value)));
      },
    };
    const stainBody = () =>
      json({
        version: V,
        schema: S,
        rows: [{ row_id: 2, fields: { 'Name@lang(en)': 'Ash Grey' } }],
      });
    await client(async () => stainBody(), {
      cache: store,
      languages: ['en'],
    }).getStains([2]);
    for (const value of backing.values()) {
      const entry = value as { rows: unknown[] };
      entry.rows = [entry.rows[0], entry.rows[0]];
    }
    const second = vi.fn(async () => stainBody());
    const result = await client(second, {
      cache: store,
      languages: ['en'],
    }).getStains([2]);
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.rows.map((r) => r.rowId)).toEqual([2]);
  });
  it('treats a cached entry whose rows are not in ascending order as a miss', async () => {
    const stains = (ids: number[]) =>
      json({
        version: V,
        schema: S,
        rows: ids.map((id) => ({
          row_id: id,
          fields: { 'Name@lang(en)': `Dye ${id}` },
        })),
      });
    const store = createMemoryCache();
    const first = vi.fn(async () => stains([2, 5]));
    await client(first, { cache: store, languages: ['en'] }).getStains([2, 5]);
    expect(first).toHaveBeenCalledTimes(1);
    const reordered = {
      set: store.set,
      async get(key: string) {
        const value = await store.get(key);
        value?.rows.reverse();
        return value;
      },
    };
    const second = vi.fn(async () => stains([2, 5]));
    const result = await client(second, {
      cache: reordered,
      languages: ['en'],
    }).getStains([2, 5]);
    expect(second).toHaveBeenCalledTimes(1);
    expect(result.rows.map((r) => r.rowId)).toEqual([2, 5]);
  });
});

describe('values from another realm and unusable signals', () => {
  it('reads response chunks created in another realm', async () => {
    const payload = JSON.stringify(page([wire()]));
    const foreign = runInNewContext(
      `new Uint8Array([${[...Buffer.from(payload)].join(',')}])`,
    ) as Uint8Array;
    expect(foreign instanceof Uint8Array).toBe(false);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(foreign);
        controller.close();
      },
    });
    const r = await client(async () => new Response(stream)).searchItems([
      body,
    ]);
    expect(r.status).toBe('complete');
    expect(r.rows[0]?.rowId).toBe(42);
  });
  it('honours a signal that is not an AbortSignal of this realm', async () => {
    class OtherSignal extends EventTarget {
      aborted = false;
    }
    const other = new OtherSignal();
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const pending = client(fetch).searchItems([body], {
      signal: other as unknown as AbortSignal,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    other.aborted = true;
    other.dispatchEvent(new Event('abort'));
    expect((await pending).status).toBe('cancelled');
  });
  it.each([
    ['an empty object', {}],
    ['a string', 'x'],
    ['a number', 1],
    ['null', null],
    ['an object without the listener methods', { aborted: false }],
    [
      'an object missing only removeEventListener',
      { aborted: false, addEventListener() {} },
    ],
    [
      'an object missing only addEventListener',
      { aborted: false, removeEventListener() {} },
    ],
    [
      'an object without a boolean aborted',
      { addEventListener() {}, removeEventListener() {} },
    ],
    [
      'an object whose aborted is not a boolean',
      { aborted: 'no', addEventListener() {}, removeEventListener() {} },
    ],
    ['an AbortSignal prototype object', Object.create(AbortSignal.prototype)],
  ])(
    'rejects %s as a signal before any request starts',
    async (_name, signal) => {
      const fetch = vi.fn(async () => json(page([wire()])));
      const c = client(fetch);
      const options = { signal } as unknown as { signal?: AbortSignal };
      await expect(c.searchItems([body], options)).rejects.toMatchObject({
        code: 'INVALID_LOOKUP',
      });
      await expect(c.getStains([2], options)).rejects.toMatchObject({
        code: 'INVALID_LOOKUP',
      });
      await expect(c.getGlasses(8, options)).rejects.toMatchObject({
        code: 'INVALID_LOOKUP',
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('rejects options whose signal getter throws, before any request', async () => {
    const fetch = vi.fn(async () => json(page([wire()])));
    const options = Object.defineProperty({}, 'signal', {
      get() {
        throw new Error('boom');
      },
    });
    const c = client(fetch);
    await expect(c.searchItems([body], options)).rejects.toMatchObject({
      code: 'INVALID_LOOKUP',
    });
    await expect(c.getStains([2], options)).rejects.toMatchObject({
      code: 'INVALID_LOOKUP',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not orphan a subscriber when the signal cannot register its listener', async () => {
    const aborts: boolean[] = [];
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>(() => {
          init?.signal?.addEventListener('abort', () => aborts.push(true));
        }),
    );
    const c = client(fetch);
    const real = new AbortController();
    const first = c.searchItems([body], { signal: real.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const bad = {
      aborted: false,
      addEventListener() {
        throw new TypeError('no listeners');
      },
      removeEventListener() {},
    } as unknown as AbortSignal;
    await expect(c.searchItems([body], { signal: bad })).rejects.toMatchObject({
      code: 'INVALID_LOOKUP',
    });
    // The failed caller must not keep the shared request alive once the real caller leaves.
    real.abort();
    expect((await first).status).toBe('cancelled');
    await vi.waitFor(() => expect(aborts).toEqual([true]));
  });
  it('settles when the signal cannot remove its listener', async () => {
    const odd = {
      aborted: false,
      addEventListener() {},
      removeEventListener() {
        throw new TypeError('no removal');
      },
    } as unknown as AbortSignal;
    const result = await Promise.race([
      client(async () => json(page([wire()]))).searchItems([body], {
        signal: odd,
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 500)),
    ]);
    expect(result).toMatchObject({ status: 'complete' });
  });
  it('rejects request options that are not an object', async () => {
    const fetch = vi.fn(async () => json(page([wire()])));
    await expect(
      client(fetch).searchItems([body], null as never),
    ).rejects.toMatchObject({ code: 'INVALID_LOOKUP' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('host caches that hang', () => {
  const stains = () =>
    json({
      version: V,
      schema: S,
      rows: [{ row_id: 2, fields: { 'Name@lang(en)': 'Ash Grey' } }],
    });
  const options = (cache: ResolutionCache) => ({
    cache,
    languages: ['en' as const],
    timeoutMs: 20,
  });
  it('keeps a fully fetched result complete when the cache write never settles', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => stains());
    let settled = false;
    const pending = client(
      fetch,
      options({
        get: async () => null,
        set: () => new Promise<void>(() => {}),
      }),
    )
      .getStains([2])
      .finally(() => {
        settled = true;
      });
    // The write is capped at timeoutMs (20 ms); the 30 s operation deadline must not be needed.
    await vi.advanceTimersByTimeAsync(25);
    expect(settled).toBe(true);
    const result = await pending;
    expect(result).toMatchObject({ status: 'complete', issues: [] });
    expect(result.rows.map((r) => r.rowId)).toEqual([2]);
  });
  it('treats a cache read that never settles as a miss after the request timeout', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => stains());
    const pending = client(
      fetch,
      options({ get: () => new Promise<null>(() => {}), set: async () => {} }),
    ).getStains([2]);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'complete', issues: [] });
  });
  it('keeps a complete result complete when the operation deadline expires during the cache write', async () => {
    vi.useFakeTimers();
    let calls = 0;
    // Three pages of 9.9 s each end just before the 30 s operation deadline.
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          const n = ++calls;
          setTimeout(
            () =>
              resolve(
                json(page([wire(40 + n)], n < 3 ? `cursor-${n}` : undefined)),
              ),
            9_900,
          );
        }),
    );
    const pending = client(fetch, {
      cache: { get: async () => null, set: () => new Promise<void>(() => {}) },
    }).searchItems([body]);
    await vi.advanceTimersByTimeAsync(40_000);
    const result = await pending;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ status: 'complete', issues: [] });
    expect(result.rows.map((r) => r.rowId)).toEqual([41, 42, 43]);
  });
  it('releases scheduler slots at once when callers cancel during pending cache reads', async () => {
    vi.useFakeTimers();
    let gets = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      json({
        version: V,
        schema: S,
        rows: (new URL(String(input)).searchParams.get('rows') ?? '')
          .split(',')
          .map((id) => ({
            row_id: Number(id),
            fields: { 'Name@lang(en)': `Dye ${id}` },
          })),
      }),
    );
    const c = client(fetch, {
      languages: ['en'],
      cache: {
        get: () =>
          ++gets <= 2 ? new Promise<null>(() => {}) : Promise.resolve(null),
        set: async () => {},
      },
    });
    const a = new AbortController();
    const b = new AbortController();
    const first = c.getStains([2], { signal: a.signal });
    const second = c.getStains([3], { signal: b.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(gets).toBe(2); // both cache reads are pending when the callers cancel
    a.abort();
    b.abort();
    expect((await first).status).toBe('cancelled');
    expect((await second).status).toBe('cancelled');
    const third = c.getStains([4]);
    await vi.advanceTimersByTimeAsync(5); // far below timeoutMs: the slots were freed
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await third).status).toBe('complete');
  });
});
