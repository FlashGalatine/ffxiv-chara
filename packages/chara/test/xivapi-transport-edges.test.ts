import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EquipmentModel } from '../src/types.js';
import {
  createMemoryCache,
  createXivapiClient,
  createXivapiResolver,
  type XivapiOptions,
} from '../src/xivapi/index.js';

// Transport behaviour that the first budget tests did not pin: a budget shared by the lookups of one
// resolution, which Retry-After forms are waited for, error bodies, cursor cycles, alias names, and
// the schema a later request names.

const V = '0123456789abcdef';
const S = `exdschema@2:rev:${'a'.repeat(40)}`;
const MIB = 1024 * 1024;
const body: EquipmentModel = { slot: 'Body', base: 361, variant: 5 };
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
  createXivapiClient({
    fetch,
    version: V,
    schema: S,
    languages: ['en'],
    ...options,
  });
const code = (result: { issues: { code: string }[] }) =>
  result.issues.map((i) => i.code);
const sized = (bytes: number, rows: unknown[], next?: string) => {
  const text = JSON.stringify(page(rows, next));
  return text + ' '.repeat(bytes - text.length);
};
afterEach(() => vi.useRealTimers());

describe('the budget a resolution shares between its lookups', () => {
  const glassesRow = { row_id: 8, fields: { 'Name@lang(en)': 'Glasses' } };
  const resolverOver = (fetch: typeof globalThis.fetch) =>
    createXivapiResolver({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });

  it('sends no Glasses request once the item lookup has used the 10 MiB', async () => {
    let glasses = 0;
    let calls = 0;
    const fetch: typeof globalThis.fetch = async (input) => {
      if (new URL(String(input)).pathname === '/api/sheet/Glasses') {
        glasses++;
        return json({ version: V, schema: S, rows: [glassesRow] });
      }
      const n = ++calls;
      // Five pages of exactly 2 MiB, then a single byte over the budget.
      return new Response(n <= 5 ? sized(2 * MIB, [wire(n)], `c${n}`) : ' ');
    };
    const result = await resolverOver(fetch).resolve({
      models: [body],
      glassesId: 8,
    });
    expect(result.items.Body?.status).toBe('partial');
    expect(result.facewear?.status).toBe('unavailable');
    expect(result.issues.map((i) => [i.code, i.path.join('/')])).toEqual([
      ['RESPONSE_LIMIT', 'items'],
      ['RESPONSE_LIMIT', 'facewear'],
    ]);
    expect(glasses).toBe(0);
  });

  it('sends no Glasses request once the item lookup has read 5,000 rows', async () => {
    let glasses = 0;
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/sheet/Glasses') {
        glasses++;
        return json({ version: V, schema: S, rows: [glassesRow] });
      }
      const at = Number(url.searchParams.get('cursor') ?? 0);
      return json(
        page(
          Array.from({ length: 500 }, (_, i) => wire(at * 500 + i + 1)),
          String(at + 1),
        ),
      );
    };
    const result = await resolverOver(fetch).resolve({
      models: [body],
      glassesId: 8,
    });
    // The eleventh page of 500 is the 5,001st row onward.
    expect(result.facewear?.status).toBe('unavailable');
    expect(result.issues.map((i) => [i.code, i.path.join('/')])).toEqual([
      ['ROW_LIMIT', 'items'],
      ['ROW_LIMIT', 'facewear'],
    ]);
    expect(glasses).toBe(0);
  });

  it('coalesces resolutions that differ only in the Glasses id into separate results', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/sheet/Glasses') {
        const id = Number(url.searchParams.get('rows'));
        return json({
          version: V,
          schema: S,
          rows: [{ row_id: id, fields: { 'Name@lang(en)': `Glasses ${id}` } }],
        });
      }
      return json(page([wire()]));
    };
    const resolver = resolverOver(fetch);
    const [eight, nine, none] = await Promise.all([
      resolver.resolve({ models: [body], glassesId: 8 }),
      resolver.resolve({ models: [body], glassesId: 9 }),
      resolver.resolve({ models: [body] }),
    ]);
    expect(eight.facewear?.id).toBe(8);
    expect(eight.facewear?.candidates.map((c) => c.rowId)).toEqual([8]);
    expect(nine.facewear?.id).toBe(9);
    expect(nine.facewear?.candidates.map((c) => c.rowId)).toEqual([9]);
    expect(none.facewear).toBeNull();
  });
});

describe('Retry-After forms that are not waited for', () => {
  const NOW = new Date('2026-01-01T00:00:00Z');
  const refused = async (header: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let calls = 0;
    const pending = client(async () => {
      calls++;
      return json({}, 429, { 'Retry-After': header });
    }).searchItems([body]);
    await vi.advanceTimersByTimeAsync(10_000);
    return { result: await pending, calls };
  };

  // Only delay-seconds (digits, with an optional fraction) and an HTTP date in the IMF-fixdate form
  // are waited for. Date.parse accepts many more strings, and what it makes of them differs between
  // engines ("-1" and "+1" are read as 1 January 2001 by V8), so everything else is refused.
  it.each([
    ['a negative number', '-1'],
    ['a larger negative number', '-13'],
    ['a signed positive number', '+1'],
    ['a number with a trailing point', '1.'],
    ['a number in exponent form', '1e3'],
    ['an exponent that would be within the cap', '1e0'],
    ['a negative exponent that would be within the cap', '2e-1'],
    ['an ISO 8601 date', '2026-01-01T00:00:00Z'],
    ['an ISO 8601 date in the future', '2026-01-01T00:00:01Z'],
    ['an RFC 850 date', 'Thursday, 01-Jan-26 00:00:01 GMT'],
    ['an asctime date', 'Thu Jan  1 00:00:01 2026'],
    [
      'an IMF date with a zone other than GMT',
      'Thu, 01 Jan 2026 00:00:01 +0000',
    ],
    ['an IMF date after other text', 'x Thu, 01 Jan 2026 00:00:01 GMT'],
    ['an IMF date before other text', 'Thu, 01 Jan 2026 00:00:01 GMT x'],
    [
      'an IMF date followed by a comment',
      'Thu, 01 Jan 2026 00:00:01 GMT (UTC)',
    ],
    ['an IMF date followed by an offset', 'Thu, 01 Jan 2026 00:00:01 GMT+0000'],
    [
      'an IMF date with only the month in lower case',
      'Thu, 01 jan 2026 00:00:01 GMT',
    ],
    ['an IMF date with an unknown weekday', 'Xyz, 01 Jan 2026 00:00:01 GMT'],
    [
      'an IMF date with the weekday written out',
      'Thursday, 01 Jan 2026 00:00:01 GMT',
    ],
    ['an IMF date with a two-digit year', 'Thu, 01 Jan 26 00:00:01 GMT'],
    ['an IMF date with a one-digit hour', 'Thu, 01 Jan 2026 0:00:01 GMT'],
    [
      'an IMF date with the zone in lower case',
      'Thu, 01 Jan 2026 00:00:01 gmt',
    ],
    ['an IMF date with the zone UTC', 'Thu, 01 Jan 2026 00:00:01 UTC'],
    ['an IMF date with a one-digit day', 'Thu, 1 Jan 2026 00:00:01 GMT'],
    ['an IMF date in lower case', 'thu, 01 jan 2026 00:00:01 gmt'],
    ['an IMF date without its weekday', '01 Jan 2026 00:00:01 GMT'],
    [
      'an IMF date with a month that is not a month',
      'Thu, 01 Foo 2026 00:00:01 GMT',
    ],
    ['a number with a unit', '1s'],
    ['a number with spaces inside', '1 000'],
  ])('refuses %s with RETRY_LIMIT after one request', async (_name, header) => {
    const { result, calls } = await refused(header);
    expect(result.status).toBe('unavailable');
    expect(code(result)).toEqual(['RETRY_LIMIT']);
    expect(calls).toBe(1);
  });

  it('refuses an asctime date that is one second ahead in the time zone of the machine, whatever that is', async () => {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const two = (n: number) => String(n).padStart(2, '0');
    const ahead = new Date(NOW.getTime() + 1000);
    // asctime has no zone, so an engine that reads it reads it as local time: this is that moment.
    const asctime = `${DAYS[ahead.getDay()]} ${MONTHS[ahead.getMonth()]} ${String(ahead.getDate()).padStart(2, ' ')} ${two(ahead.getHours())}:${two(ahead.getMinutes())}:${two(ahead.getSeconds())} ${ahead.getFullYear()}`;
    const { result, calls } = await refused(asctime);
    expect(code(result)).toEqual(['RETRY_LIMIT']);
    expect(calls).toBe(1);
  });

  it('still waits for an IMF-fixdate one second ahead and for 1.5 seconds', async () => {
    for (const [header, wait] of [
      ['Thu, 01 Jan 2026 00:00:01 GMT', 1000],
      ['1.5', 1500],
    ] as const) {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      let calls = 0;
      const pending = client(async () =>
        ++calls === 1
          ? json({}, 429, { 'Retry-After': header })
          : json(page([wire()])),
      ).searchItems([body]);
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(2);
      expect((await pending).status).toBe('complete');
      vi.useRealTimers();
    }
  });

  it.each([
    [429, 429],
    [429, 503],
    [503, 503],
    [503, 429],
  ])(
    'does not wait again: a %i answered by a %i that asks for 3 s is UPSTREAM_UNAVAILABLE',
    async (first, second) => {
      vi.useFakeTimers();
      let calls = 0;
      const pending = client(async () =>
        ++calls === 1
          ? json({}, first, { 'Retry-After': '1' })
          : json({}, second, { 'Retry-After': '3' }),
      ).searchItems([body]);
      // Only the first wait is advanced: the result is settled by then.
      await vi.advanceTimersByTimeAsync(1000);
      const result = await pending;
      expect(code(result)).toEqual(['UPSTREAM_UNAVAILABLE']);
      expect(calls).toBe(2);
    },
  );
});

describe('error bodies and cursors', () => {
  it('stops reading an error body at 2 MiB', async () => {
    let cancelled = false;
    const big = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(3 * MIB));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 500 },
      );
    const result = await client(async () => big()).searchItems([body]);
    expect(code(result)).toEqual(['RESPONSE_LIMIT']);
    expect(cancelled).toBe(true);
    // A 404 to a Glasses row list keeps its chunks to read the missing row, but not past 2 MiB.
    const glasses = await client(async () => big()).getGlasses(8);
    expect(code(glasses)).toEqual(['RESPONSE_LIMIT']);
  });

  it('refuses a cursor that returns after another one, not only one that repeats at once', async () => {
    const cursors = ['A', 'B', 'A', 'C'];
    let calls = 0;
    const result = await client(async () => {
      const at = calls++;
      return json(page([wire(at + 1)], cursors[at]));
    }).searchItems([body]);
    expect(result.status).toBe('partial');
    expect(code(result)).toEqual(['REPEATED_CURSOR']);
    expect(calls).toBe(3);
    expect(result.rows).toHaveLength(3);
  });
});

describe('the alias and the schema a later request names', () => {
  it('finds an alias that is not the first name of its version entry', async () => {
    const searched: (string | null)[] = [];
    const result = await createXivapiClient({
      schema: S,
      languages: ['en'],
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/version'))
          return json({
            versions: [
              { key: 'fedcba9876543210', names: ['7.2', 'previous'] },
              { key: V, names: ['7.3', 'latest'] },
            ],
          });
        searched.push(url.searchParams.get('version'));
        return json(page([wire()]));
      },
    }).searchItems([body]);
    expect(result.status).toBe('complete');
    expect(searched).toEqual([V]);
  });

  it('names the learned revision in a later request that misses the cache', async () => {
    const DEFAULT = 'exdschema@2:ver:request';
    const schemas: (string | null)[] = [];
    const c = createXivapiClient({
      version: V,
      languages: ['en'],
      cache: createMemoryCache(),
      fetch: async (input) => {
        schemas.push(new URL(String(input)).searchParams.get('schema'));
        return json(page([wire()]));
      },
    });
    await c.searchItems([body]);
    // Another selection, so the cache cannot answer: the request itself must name the revision.
    await c.searchItems([{ slot: 'Body', base: 362, variant: 5 }]);
    expect(schemas).toEqual([DEFAULT, S]);
  });
});
