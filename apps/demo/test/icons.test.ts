import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EquipmentResolution } from 'xivcharakit/xivapi';
import { iconKey, loadIcons } from '../src/icons.js';

const V = '0123456789abcdef';
const KIB = 1024;

/** A PNG-shaped buffer: signature, then an IHDR chunk with the given size, padded to `length`. */
function png({
  width = 32,
  height = 32,
  length = 24,
  signature = [137, 80, 78, 71, 13, 10, 26, 10],
  chunk = 0x49484452,
} = {}): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(Math.max(length, 8)));
  bytes.set(signature);
  if (bytes.length >= 24) {
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    view.setUint32(12, chunk);
    view.setUint32(16, width);
    view.setUint32(20, height);
  }
  return bytes;
}
const answer = (
  body: BodyInit | null,
  init: ResponseInit = { headers: { 'Content-Type': 'image/png' } },
) => new Response(body, init);
const NO_VERSION = Symbol('no version');
function resolution(
  ids: (number | null | undefined)[],
  version: string | number | null | typeof NO_VERSION = V,
): EquipmentResolution {
  return {
    items: Object.fromEntries(
      ids.map((id, i) => [`slot${i}`, { candidates: [{ iconId: id }] }]),
    ),
    upstream: { items: version === NO_VERSION ? undefined : { version } },
  } as unknown as EquipmentResolution;
}

let fetched: { url: URL; init: RequestInit }[];
let respond: (url: URL, init: RequestInit) => Response | Promise<Response>;
const ready = vi.fn<(key: string, url: string) => void>();
const run = (
  result: EquipmentResolution,
  signal = new AbortController().signal,
) => loadIcons(result, signal, ready);

beforeEach(() => {
  fetched = [];
  respond = () => answer(png());
  ready.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL, init: RequestInit) => {
      fetched.push({ url: new URL(input), init });
      return respond(new URL(input), init);
    }),
  );
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the icon request', () => {
  it('is a credential-free, referrer-free, redirect-refusing GET to the fixed asset route', async () => {
    await run(resolution([12345]));
    expect(fetched).toHaveLength(1);
    const { url, init } = fetched[0] ?? { url: new URL('x:'), init: {} };
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://v2.xivapi.com/api/asset',
    );
    expect([...url.searchParams.keys()].sort()).toEqual([
      'format',
      'path',
      'version',
    ]);
    expect(url.searchParams.get('path')).toBe('ui/icon/012000/012345_hr1.tex');
    expect(url.searchParams.get('format')).toBe('png');
    expect(url.searchParams.get('version')).toBe(V);
    expect(init).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'manual',
    });
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.body ?? null).toBeNull();
  });
  it('is cancelled with the lookup', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    respond = (_url, init) => {
      seen = init.signal ?? undefined;
      return answer(png());
    };
    await loadIcons(resolution([5]), controller.signal, ready);
    expect(seen?.aborted).toBe(false);
    controller.abort();
    expect(seen?.aborted).toBe(true);
  });
  it('is bounded by a five second timeout that reaches the request itself', async () => {
    // A timeout signal the test controls, so that the signal fetch receives can be tied to it.
    const expiry = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(expiry.signal);
    let seen: AbortSignal | undefined;
    respond = (_url, init) => {
      seen = init.signal ?? undefined;
      return answer(png());
    };
    await run(resolution([5]));
    expect(timeout).toHaveBeenCalledExactlyOnceWith(5000);
    expect(seen?.aborted).toBe(false);
    expiry.abort();
    expect(seen?.aborted).toBe(true);
  });
  it('is keyed by version and id and reaches the page as an object URL', async () => {
    await run(resolution([12345]));
    expect(ready).toHaveBeenCalledExactlyOnceWith(
      iconKey(12345, V),
      'blob:test',
    );
  });
  it('pads small ids to the six digit sheet path', async () => {
    await run(resolution([7, 1000000]));
    expect(fetched.map(({ url }) => url.searchParams.get('path'))).toEqual([
      'ui/icon/000000/000007_hr1.tex',
      'ui/icon/1000000/1000000_hr1.tex',
    ]);
  });
});

describe('which icons are requested', () => {
  it('accepts only a sixteen digit lowercase hexadecimal version', async () => {
    const versions: (string | number | null | typeof NO_VERSION)[] = [
      // A number that reads as sixteen digits once it is turned into text.
      1234567890123456,
      'ABCDEF0123456789',
      '0123456789abcde',
      '0123456789abcdef0',
      '0123456789abcdeg',
      '../0123456789abc',
      '',
      null,
      NO_VERSION,
    ];
    for (const version of versions) await run(resolution([1], version));
    expect(fetched).toHaveLength(0);
    await run(resolution([1], V));
    expect(fetched).toHaveLength(1);
  });
  it('accepts only integer ids from 1 to 0xffffffff', async () => {
    await run(
      resolution([0, -1, 1.5, Number.NaN, 2 ** 32, 2 ** 53, null, undefined]),
    );
    expect(fetched).toHaveLength(0);
    await run(resolution([1, 0xffffffff]));
    expect(fetched).toHaveLength(2);
  });
  it('requests at most sixteen distinct icons and one request per icon', async () => {
    await run(resolution(Array.from({ length: 20 }, (_, i) => i + 1)));
    expect(fetched).toHaveLength(16);
    fetched.length = 0;
    await run(resolution([9, 9, 9]));
    expect(fetched).toHaveLength(1);
  });
  it('asks for the facewear icon with the facewear version', async () => {
    const other = 'fedcba9876543210';
    const result = {
      items: {},
      facewear: { candidates: [{ iconId: 40 }] },
      upstream: { items: { version: V }, facewear: { version: other } },
    } as unknown as EquipmentResolution;
    await run(result);
    expect(fetched.map(({ url }) => url.searchParams.get('version'))).toEqual([
      other,
    ]);
  });
});

describe('which responses become images', () => {
  it('refuses a failed, redirected, empty or non-PNG response', async () => {
    const cases: Response[] = [
      answer(png(), { status: 404, headers: { 'Content-Type': 'image/png' } }),
      answer(png(), { status: 500, headers: { 'Content-Type': 'image/png' } }),
      Response.redirect('https://example.invalid/icon.png', 302),
      answer(png(), { headers: { 'Content-Type': 'image/svg+xml' } }),
      answer(png(), { headers: { 'Content-Type': 'text/html' } }),
      answer(png(), { headers: {} }),
      answer(null),
    ];
    for (const response of cases) {
      respond = () => response;
      await run(resolution([3]));
    }
    expect(fetched).toHaveLength(cases.length);
    expect(ready).not.toHaveBeenCalled();
  });
  it('checks the PNG signature, the IHDR chunk and a 1 to 256 pixel size', async () => {
    const refused = [
      png({ signature: [137, 80, 78, 71, 13, 10, 26, 11] }),
      png({ signature: [0, 0, 0, 0, 0, 0, 0, 0] }),
      png({ chunk: 0x49444154 }),
      png({ width: 0 }),
      png({ height: 0 }),
      png({ width: 257 }),
      png({ height: 257 }),
      png({ width: 2 ** 32 - 1 }),
      png({ length: 23 }),
      new Uint8Array(0),
    ];
    for (const bytes of refused) {
      respond = () => answer(bytes);
      await run(resolution([3]));
    }
    expect(ready).not.toHaveBeenCalled();
    for (const [width, height] of [
      [1, 1],
      [256, 256],
      [1, 256],
    ] as const) {
      respond = () => answer(png({ width, height }));
      await run(resolution([3]));
    }
    expect(ready).toHaveBeenCalledTimes(3);
  });
});

describe('the size limits', () => {
  it('stops one icon at 256 KiB and cancels its body', async () => {
    respond = () => answer(png({ length: 256 * KIB }));
    await run(resolution([1]));
    expect(ready).toHaveBeenCalledTimes(1);
    ready.mockReset();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * KIB));
      },
      cancel() {
        cancelled = true;
      },
    });
    respond = () => answer(body);
    await run(resolution([2]));
    expect(ready).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(cancelled).toBe(true));
    respond = () => answer(png({ length: 256 * KIB + 1 }));
    await run(resolution([3]));
    expect(ready).not.toHaveBeenCalled();
  });
  it('stops after 2 MiB in all: no ninth icon once eight of 256 KiB are in', async () => {
    respond = () => answer(png({ length: 256 * KIB }));
    await run(resolution(Array.from({ length: 12 }, (_, i) => i + 1)));
    expect(fetched).toHaveLength(8);
    expect(ready).toHaveBeenCalledTimes(8);
  });
  it('drops the icon that crosses 2 MiB while it is being read', async () => {
    respond = () => answer(png({ length: 250_000 }));
    await run(resolution(Array.from({ length: 12 }, (_, i) => i + 1)));
    expect(fetched).toHaveLength(9);
    expect(ready).toHaveBeenCalledTimes(8);
  });
});

describe('failure and cancellation', () => {
  it('does not let one failed icon stop the others', async () => {
    let calls = 0;
    respond = () => {
      if (calls++ === 0) throw new Error('network down');
      return answer(png());
    };
    await run(resolution([1, 2]));
    expect(fetched).toHaveLength(2);
    expect(ready).toHaveBeenCalledExactlyOnceWith(iconKey(2, V), 'blob:test');
  });
  it('requests nothing for a lookup that is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await run(resolution([1, 2]), controller.signal);
    expect(fetched).toHaveLength(0);
    expect(ready).not.toHaveBeenCalled();
  });
  it('stops after the lookup is cancelled and reports no icon for the one in flight', async () => {
    const controller = new AbortController();
    respond = () => {
      controller.abort();
      return answer(png());
    };
    await loadIcons(resolution([1, 2, 3]), controller.signal, ready);
    expect(fetched).toHaveLength(1);
    expect(ready).not.toHaveBeenCalled();
  });
  it('stops requesting once the page has what it needs to cancel', async () => {
    const controller = new AbortController();
    const first = vi.fn(() => controller.abort());
    await loadIcons(resolution([1, 2, 3]), controller.signal, first);
    expect(first).toHaveBeenCalledTimes(1);
    expect(fetched).toHaveLength(1);
  });
});
