import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EquipmentModel } from '../src/types.js';
import {
  createMemoryCache,
  createXivapiClient,
  type XivapiOptions,
} from '../src/xivapi/index.js';

// Each limit of the XIVAPI transport is pinned from both sides: the largest value that is accepted
// and the smallest that is refused, with the code that refuses it. A refusal that fires only
// because another check fired first would not show that the limit itself is there.

const V = '0123456789abcdef';
const V2 = 'fedcba9876543210';
const S = `exdschema@2:rev:${'a'.repeat(40)}`;
const body: EquipmentModel = { slot: 'Body', base: 361, variant: 5 };
const MIB = 1024 * 1024;
const wire = (rowId = 42) => ({
  sheet: 'Item',
  row_id: rowId,
  fields: {
    'Name@lang(en)': 'Example',
    Icon: { id: 123 },
    ModelMain: 328041,
    ModelSub: 0,
    EquipSlotCategory: { fields: { Body: 1 } },
    DyeCount: 2,
    IsGlamorous: true,
  },
});
const page = (results: unknown[] = [], next?: unknown) => ({
  version: V,
  schema: S,
  results,
  ...(next !== undefined ? { next } : {}),
});
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

/** A valid page with one extra top-level member written as raw JSON text. */
const withMember = (rawMember: string, rows: unknown[] = [wire()]) =>
  `${JSON.stringify(page(rows)).slice(0, -1)},${rawMember}}`;
/** A body of exactly this many bytes: a valid page followed by spaces. */
const sized = (bytes: number, rows: unknown[] = [wire()], next?: string) => {
  const text = JSON.stringify(page(rows, next));
  if (text.length > bytes) throw new Error('The page is larger than the size.');
  return text + ' '.repeat(bytes - text.length);
};
const levels = (depth: number) => `${'['.repeat(depth)}${']'.repeat(depth)}`;

describe('the structure of a response, inside an otherwise valid page', () => {
  // The page object is depth 1 and a member's value starts at depth 2; every value and every key is
  // a node. A page with no results and an empty padding array has 9 nodes: the object, its four
  // keys, and the version, schema, results and padding values.
  const NODES_WITHOUT_PADDING = 9;
  const accepted: [string, string][] = [
    ['an array nested to the depth ceiling', `"padding":${levels(31)}`],
    ['a string of 65,536 characters', `"padding":"${'x'.repeat(65_536)}"`],
    ['a key of 1,024 characters', `"${'k'.repeat(1024)}":1`],
    ['the largest safe integer', '"padding":9007199254740991'],
  ];
  const refused: [string, string][] = [
    ['an array nested one level too deep', `"padding":${levels(32)}`],
    ['a string of 65,537 characters', `"padding":"${'x'.repeat(65_537)}"`],
    ['a key of 1,025 characters', `"${'k'.repeat(1025)}":1`],
    ['an integer above the safe range', '"padding":9007199254740993'],
    ['a repeated key', '"results":[]'],
    ['a number with a leading zero', '"padding":01'],
    ['text after the document', '"padding":0}x{'],
  ];

  it.each(accepted)('accepts %s', async (_name, member) => {
    const r = await client(
      async () => new Response(withMember(member)),
    ).searchItems([body]);
    expect(r.status, JSON.stringify(r.issues)).toBe('complete');
    expect(r.rows.map((row) => row.rowId)).toEqual([42]);
  });

  it.each(refused)(
    'refuses %s with MALFORMED_RESPONSE',
    async (_name, member) => {
      const r = await client(
        async () => new Response(withMember(member)),
      ).searchItems([body]);
      expect(r.status).toBe('unavailable');
      expect(code(r)).toEqual(['MALFORMED_RESPONSE']);
      expect(r.rows).toEqual([]);
    },
  );

  it('allows exactly 100,000 nodes and refuses one more', async () => {
    const padded = (n: number) =>
      withMember(`"padding":[${new Array(n).fill(0).join(',')}]`, []);
    const ok = await client(
      async () => new Response(padded(100_000 - NODES_WITHOUT_PADDING)),
    ).searchItems([body]);
    expect(ok.status, JSON.stringify(ok.issues)).toBe('complete');
    const over = await client(
      async () => new Response(padded(100_001 - NODES_WITHOUT_PADDING)),
    ).searchItems([body]);
    expect(over.status).toBe('unavailable');
    expect(code(over)).toEqual(['MALFORMED_RESPONSE']);
  });

  it('refuses text that is not JSON without echoing it', async () => {
    const r = await client(async () => new Response('{PRIVATE')).searchItems([
      body,
    ]);
    expect(code(r)).toEqual(['MALFORMED_RESPONSE']);
    expect(JSON.stringify(r)).not.toContain('PRIVATE');
  });

  it('allows 500 results in a page and refuses 501 with ROW_LIMIT', async () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => wire(i + 1));
    const ok = await client(async () => json(page(rows(500)))).searchItems([
      body,
    ]);
    expect(ok.status).toBe('complete');
    expect(ok.rows).toHaveLength(500);
    const over = await client(async () => json(page(rows(501)))).searchItems([
      body,
    ]);
    expect(over.status).toBe('unavailable');
    expect(code(over)).toEqual(['ROW_LIMIT']);
  });

  it('refuses a results member that is not an array with ROW_LIMIT', async () => {
    const r = await client(async () =>
      json({ version: V, schema: S, results: { length: 1 } }),
    ).searchItems([body]);
    expect(code(r)).toEqual(['ROW_LIMIT']);
  });
});

describe('the size of a response', () => {
  it('accepts a page of exactly 2 MiB and refuses one byte more', async () => {
    const exact = await client(
      async () => new Response(sized(2 * MIB)),
    ).searchItems([body]);
    expect(exact.status).toBe('complete');
    expect(exact.rows).toHaveLength(1);
    const over = await client(
      async () => new Response(sized(2 * MIB + 1)),
    ).searchItems([body]);
    expect(over.status).toBe('unavailable');
    expect(code(over)).toEqual(['RESPONSE_LIMIT']);
  });

  it('counts the bytes of all responses of one lookup against 10 MiB', async () => {
    // Pages 1 to 5 are exactly 2 MiB each; a sixth is small. Every page but the last has a cursor.
    const serve = (total: number) => {
      let calls = 0;
      return {
        calls: () => calls,
        fetch: async () => {
          const n = ++calls;
          const next = n < total ? `c${n}` : undefined;
          return new Response(n <= 5 ? sized(2 * MIB, [wire(n)], next) : ' ');
        },
      };
    };
    // Five pages of exactly 2 MiB are exactly 10 MiB: allowed.
    const five = serve(5);
    const ok = await client(five.fetch).searchItems([body]);
    expect(ok.status, JSON.stringify(ok.issues)).toBe('complete');
    expect(ok.rows.map((r) => r.rowId)).toEqual([1, 2, 3, 4, 5]);
    expect(five.calls()).toBe(5);
    // A single byte beyond that, in a sixth response, is refused and keeps the five pages already read.
    const six = serve(6);
    const over = await client(six.fetch).searchItems([body]);
    expect(over.status).toBe('partial');
    expect(code(over)).toEqual(['RESPONSE_LIMIT']);
    expect(over.rows.map((r) => r.rowId)).toEqual([1, 2, 3, 4, 5]);
    expect(six.calls()).toBe(6);
  });
});

describe('cursors', () => {
  const twoPages = (cursor: unknown) => {
    const urls: URL[] = [];
    const fetch = async (url: URL | RequestInfo) => {
      urls.push(new URL(String(url)));
      return json(
        urls.length === 1 ? page([wire(1)], cursor) : page([wire(2)]),
      );
    };
    return { urls, fetch };
  };

  it('follows a cursor of 2,048 characters and sends it back unchanged', async () => {
    const cursor = 'c'.repeat(2048);
    const run = twoPages(cursor);
    const r = await client(run.fetch).searchItems([body]);
    expect(r.status).toBe('complete');
    expect(r.rows.map((row) => row.rowId)).toEqual([1, 2]);
    expect(run.urls[1]?.searchParams.get('cursor')).toBe(cursor);
  });

  it.each([
    ['2,049 characters long', 'c'.repeat(2049)],
    ['empty', ''],
    ['a number', 5],
    ['a boolean', false],
    ['an object', { cursor: 'x' }],
  ])(
    'refuses a cursor that is %s with INVALID_CURSOR',
    async (_name, cursor) => {
      const run = twoPages(cursor);
      const r = await client(run.fetch).searchItems([body]);
      expect(r.status).toBe('partial');
      expect(code(r)).toEqual(['INVALID_CURSOR']);
      expect(r.rows.map((row) => row.rowId)).toEqual([1]);
      expect(run.urls).toHaveLength(1);
    },
  );

  it.each([
    ['null', null],
    ['absent', undefined],
  ])('ends the lookup when the next cursor is %s', async (_name, cursor) => {
    const run = twoPages(cursor);
    const r = await client(run.fetch).searchItems([body]);
    expect(r.status).toBe('complete');
    expect(run.urls).toHaveLength(1);
  });

  it('refuses a cursor that is sent again with REPEATED_CURSOR, after the first use', async () => {
    let calls = 0;
    const r = await client(async () =>
      json(page([wire(++calls)], 'same')),
    ).searchItems([body]);
    expect(r.status).toBe('partial');
    expect(code(r)).toEqual(['REPEATED_CURSOR']);
    expect(calls).toBe(2);
  });

  it('stops at the page limit with PAGE_LIMIT, keeping what it has', async () => {
    let calls = 0;
    const r = await client(
      async () => json(page([wire(++calls)], `c${calls}`)),
      {
        maxPages: 3,
      },
    ).searchItems([body]);
    expect(r.status).toBe('partial');
    expect(code(r)).toEqual(['PAGE_LIMIT']);
    expect(calls).toBe(3);
    expect(r.rows).toHaveLength(3);
    let last = 0;
    const done = await client(
      async () => json(page([wire(++last)], last < 3 ? `c${last}` : undefined)),
      { maxPages: 3 },
    ).searchItems([body]);
    expect(done.status).toBe('complete');
    expect(done.rows).toHaveLength(3);
  });
});

describe('a latest-style alias and its version list', () => {
  const decoy = (i: number) => ({
    key: i.toString(16).padStart(16, '0'),
    names: [`other-${i}`],
  });
  const aliased = (versions: unknown, options: XivapiOptions = {}) => {
    const searched: string[] = [];
    const fetch = async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/version')) return json({ versions });
      searched.push(url.searchParams.get('version') ?? 'missing');
      return json(page([wire()]));
    };
    return {
      searched,
      run: () =>
        createXivapiClient({ fetch, schema: S, ...options }).searchItems([
          body,
        ]),
    };
  };
  const listOf = (n: number) => [
    ...Array.from({ length: n - 1 }, (_, i) => decoy(i + 1)),
    { key: V, names: ['latest'] },
  ];

  it('resolves the alias from a list of 500 entries and not from 501', async () => {
    const found = aliased(listOf(500));
    expect((await found.run()).status).toBe('complete');
    expect(found.searched).toEqual([V]);
    const unresolved = aliased(listOf(501));
    expect((await unresolved.run()).status).toBe('complete');
    expect(unresolved.searched).toEqual(['latest']);
  });

  it.each([
    ['an object instead of a list', { 0: { key: V, names: ['latest'] } }],
    [
      'an entry whose key is not a version hash',
      [{ key: 'latest', names: ['latest'] }],
    ],
    [
      'an entry whose key is an uppercase hash',
      [{ key: V.toUpperCase(), names: ['latest'] }],
    ],
    ['an entry whose names is not a list', [{ key: V, names: 'latest' }]],
    ['an entry that names another alias', [{ key: V, names: ['Latest'] }]],
    ['entries that are not records', [null, 'x', 7]],
  ])('leaves the alias unresolved for %s', async (_name, versions) => {
    const run = aliased(versions);
    expect((await run.run()).status).toBe('complete');
    expect(run.searched).toEqual(['latest']);
  });

  it('remembers a resolved alias for exactly ten minutes', async () => {
    vi.useFakeTimers();
    let versionRequests = 0;
    const c = createXivapiClient({
      schema: S,
      fetch: async (input) => {
        if (new URL(String(input)).pathname.endsWith('/version')) {
          versionRequests++;
          return json({ versions: [{ key: V, names: ['latest'] }] });
        }
        return json(page([wire()]));
      },
    });
    await c.searchItems([body]);
    expect(versionRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(599_999);
    await c.searchItems([body]);
    expect(versionRequests).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await c.searchItems([body]);
    expect(versionRequests).toBe(2);
  });

  it('uses the first entry that names the alias', async () => {
    const run = aliased([
      { key: V2, names: ['latest'] },
      { key: V, names: ['latest'] },
    ]);
    await run.run();
    expect(run.searched).toEqual([V2]);
  });
});

describe('Retry-After and the single retry', () => {
  const NOW = new Date('2026-01-01T00:00:00Z');
  const at = (ms: number) => new Date(NOW.getTime() + ms).toUTCString();
  const lookup = (status: number, header: string | null, second = 200) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let calls = 0;
    const promise = client(async () =>
      ++calls === 1
        ? json(
            {},
            status,
            header === null ? undefined : { 'Retry-After': header },
          )
        : second === 200
          ? json(page([wire()]))
          : json({}, second),
    ).searchItems([body]);
    return { promise, calls: () => calls };
  };

  it.each([
    ['absent', null, 250],
    ['0', '0', 0],
    ['0.5', '0.5', 500],
    ['1', '1', 1000],
    ['2', '2', 2000],
    ['2.000', '2.000', 2000],
    ['a date 1 s ahead', at(1000), 1000],
    ['a date 2 s ahead', at(2000), 2000],
    ['the current date', at(0), 0],
    ['a date in the past', at(-60_000), 0],
  ])(
    'waits for the stated time when Retry-After is %s',
    async (_name, header, wait) => {
      const run = lookup(429, header);
      if (wait > 0) {
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(run.calls()).toBe(1);
      }
      await vi.advanceTimersByTimeAsync(1);
      expect(run.calls()).toBe(2);
      expect((await run.promise).status).toBe('complete');
    },
  );

  it.each([
    ['2.001', '2.001'],
    ['3', '3'],
    ['999999', '999999'],
    ['a date 3 s ahead', at(3000)],
    ['text that is neither a number nor a date', 'garbage'],
    ['an empty value', ''],
  ])(
    'refuses to wait, with RETRY_LIMIT, when Retry-After is %s',
    async (_name, header) => {
      const run = lookup(429, header);
      await vi.advanceTimersByTimeAsync(10_000);
      const r = await run.promise;
      expect(r.status).toBe('unavailable');
      expect(code(r)).toEqual(['RETRY_LIMIT']);
      expect(run.calls()).toBe(1);
    },
  );

  it.each([
    [429, 429],
    [429, 503],
    [503, 503],
    [503, 429],
  ])(
    'retries only once: a %i answered by a %i is UPSTREAM_UNAVAILABLE',
    async (first, second) => {
      const run = lookup(first, '1', second);
      await vi.advanceTimersByTimeAsync(10_000);
      const r = await run.promise;
      expect(r.status).toBe('unavailable');
      expect(code(r)).toEqual(['UPSTREAM_UNAVAILABLE']);
      expect(run.calls()).toBe(2);
    },
  );

  it.each([500, 502, 504])('does not retry a %i', async (status) => {
    const run = lookup(status, '1');
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await run.promise;
    expect(code(r)).toEqual(['UPSTREAM_UNAVAILABLE']);
    expect(run.calls()).toBe(1);
  });
});

describe('redirects', () => {
  it.each([300, 301, 302, 303, 304, 307, 308, 399])(
    'does not follow a %i and reports REDIRECT_REFUSED',
    async (status) => {
      let calls = 0;
      const r = await client(async () => {
        calls++;
        return new Response(status === 304 ? null : 'PRIVATE', {
          status,
          headers: { Location: 'https://evil.invalid/next' },
        });
      }).searchItems([body]);
      expect(r.status).toBe('unavailable');
      expect(code(r)).toEqual(['REDIRECT_REFUSED']);
      expect(calls).toBe(1);
      expect(JSON.stringify(r)).not.toMatch(/PRIVATE|evil/);
    },
  );

  it('releases the body of a redirect without reading it', async () => {
    let cancelled = false;
    const r = await client(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 302 },
        ),
    ).searchItems([body]);
    expect(code(r)).toEqual(['REDIRECT_REFUSED']);
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });

  it('treats 299 as success and 400 as an unavailable upstream', async () => {
    const ok = await client(
      async () => new Response(JSON.stringify(page([wire()])), { status: 299 }),
    ).searchItems([body]);
    expect(ok.status).toBe('complete');
    const bad = await client(async () => json({}, 400)).searchItems([body]);
    expect(code(bad)).toEqual(['UPSTREAM_UNAVAILABLE']);
  });
});

describe('the memory of the schema a default request was answered with', () => {
  // With the default schema (exdschema@2:ver:request) the first answer names the revision it used.
  // That revision is remembered for ten minutes: the next request names it, and only a request that
  // names a revision can be read from or written to a cache.
  const DEFAULT_SCHEMA = 'exdschema@2:ver:request';
  const setup = (rowsFor: (call: number) => unknown[] = () => [wire()]) => {
    vi.useFakeTimers();
    const schemas: (string | null)[] = [];
    const c = createXivapiClient({
      version: V,
      cache: createMemoryCache(),
      fetch: async (input) => {
        schemas.push(new URL(String(input)).searchParams.get('schema'));
        return json(page(rowsFor(schemas.length)));
      },
    });
    return { schemas, search: () => c.searchItems([body]) };
  };

  it('names the learned revision in the next request, which is then a cache hit', async () => {
    const run = setup();
    expect((await run.search()).status).toBe('complete');
    expect(run.schemas).toEqual([DEFAULT_SCHEMA]);
    expect((await run.search()).status).toBe('complete');
    expect(run.schemas).toEqual([DEFAULT_SCHEMA]);
  });

  it('still remembers the revision one millisecond before ten minutes', async () => {
    const run = setup();
    await run.search();
    await vi.advanceTimersByTimeAsync(599_999);
    await run.search();
    expect(run.schemas).toEqual([DEFAULT_SCHEMA]);
  });

  it('has forgotten it after exactly ten minutes, and asks with the default again', async () => {
    const run = setup();
    await run.search();
    await vi.advanceTimersByTimeAsync(600_000);
    await run.search();
    expect(run.schemas).toEqual([DEFAULT_SCHEMA, DEFAULT_SCHEMA]);
  });

  it('does not remember a revision from a lookup that was not complete', async () => {
    const unrelated = wire(7);
    unrelated.fields.ModelMain = 1;
    const run = setup((call) => (call === 1 ? [wire(), unrelated] : [wire()]));
    expect((await run.search()).status).toBe('partial');
    expect((await run.search()).status).toBe('complete');
    // The second request still asked with the default; the complete answer is what is remembered.
    expect(run.schemas).toEqual([DEFAULT_SCHEMA, DEFAULT_SCHEMA]);
    expect((await run.search()).status).toBe('complete');
    expect(run.schemas).toEqual([DEFAULT_SCHEMA, DEFAULT_SCHEMA]);
  });
});
