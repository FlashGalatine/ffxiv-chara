import { describe, expect, it, vi } from 'vitest';
import { createDyeNameResolver } from '../src/dyes/index.js';
import type { EquipmentModel } from '../src/types.js';
import {
  createXivapiClient,
  createXivapiResolver,
  type XivapiOptions,
} from '../src/xivapi/index.js';

// Input limits are pinned from both sides (the largest accepted, the smallest refused) with the
// code that refuses, and the host options guard that the dye resolver relies on.

const V = '0123456789abcdef';
const S = `exdschema@2:rev:${'a'.repeat(40)}`;
const body: EquipmentModel = { slot: 'Body', base: 361, variant: 5 };
const json = (data: unknown) => new Response(JSON.stringify(data));
const stainsFor = (input: URL | RequestInfo) => {
  const url = new URL(String(input));
  const rows = (url.searchParams.get('rows') ?? '').split(',').filter(Boolean);
  return {
    url,
    response: json({
      version: V,
      schema: S,
      rows: rows.map((id) => ({
        row_id: Number(id),
        fields: { 'Name@lang(en)': `Dye ${id}` },
      })),
    }),
  };
};
const dyeClient = () => {
  const requested: string[] = [];
  const fetch = vi.fn(async (input: URL | RequestInfo) => {
    const { url, response } = stainsFor(input);
    requested.push(url.searchParams.get('rows') ?? '');
    return response;
  });
  return {
    fetch,
    requested,
    client: createXivapiClient({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    }),
  };
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('the number and range of dye ids', () => {
  it('accepts exactly 64 ids and refuses 65 with INVALID_LOOKUP before any request', async () => {
    const ok = dyeClient();
    const result = await ok.client.getStains(ids(64));
    expect(result.status).toBe('complete');
    expect(result.rows).toHaveLength(64);
    expect(ok.requested[0]?.split(',')).toHaveLength(64);
    const over = dyeClient();
    await expect(over.client.getStains(ids(65))).rejects.toMatchObject({
      name: 'XivapiInputError',
      code: 'INVALID_LOOKUP',
    });
    expect(over.fetch).not.toHaveBeenCalled();
  });

  it('counts the list as given: 65 repeats of one id are still too many', async () => {
    const run = dyeClient();
    await expect(
      run.client.getStains(new Array(65).fill(1)),
    ).rejects.toMatchObject({
      code: 'INVALID_LOOKUP',
    });
    expect(run.fetch).not.toHaveBeenCalled();
  });

  it('sends each id once, in ascending order', async () => {
    const run = dyeClient();
    await run.client.getStains([30, 2, 30, 7, 2]);
    expect(run.requested).toEqual(['2,7,30']);
  });

  it('accepts the ids 0 and 65,535 and refuses everything outside that range', async () => {
    const ok = dyeClient();
    expect((await ok.client.getStains([0, 65_535])).status).toBe('complete');
    expect(ok.requested).toEqual(['0,65535']);
    for (const bad of [
      65_536,
      -1,
      1.5,
      Number.NaN,
      Infinity,
      '3',
      null,
      undefined,
      3n,
      {},
    ]) {
      const run = dyeClient();
      await expect(run.client.getStains([bad as never])).rejects.toMatchObject({
        code: 'INVALID_LOOKUP',
      });
      expect(run.fetch).not.toHaveBeenCalled();
    }
  });

  it('refuses a list that is not a plain array, or has holes', async () => {
    // biome-ignore lint/suspicious/noSparseArray: the case under test
    const sparse = [, 1];
    for (const bad of [
      sparse,
      'abc',
      { length: 1, 0: 1 },
      null,
      undefined,
      5,
    ]) {
      const run = dyeClient();
      await expect(run.client.getStains(bad as never)).rejects.toMatchObject({
        code: 'INVALID_LOOKUP',
      });
      expect(run.fetch).not.toHaveBeenCalled();
    }
  });

  it('refuses the same input through the dye-name resolver, with the same code', async () => {
    const fetch = vi.fn(
      async (input: URL | RequestInfo) => stainsFor(input).response,
    );
    const resolver = createDyeNameResolver({
      fetch,
      version: V,
      schema: S,
      languages: ['en'],
    });
    await expect(resolver.resolve(ids(65))).rejects.toMatchObject({
      name: 'XivapiInputError',
      code: 'INVALID_LOOKUP',
    });
    await expect(resolver.resolve([65_536])).rejects.toMatchObject({
      code: 'INVALID_LOOKUP',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect((await resolver.resolve(ids(64))).rows).toHaveLength(64);
  });
});

describe('the number of equipment models', () => {
  const lookup = () => {
    const urls: URL[] = [];
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      urls.push(new URL(String(input)));
      return json({ version: V, schema: S, results: [] });
    });
    return {
      fetch,
      urls,
      options: { fetch, version: V, schema: S } satisfies XivapiOptions,
    };
  };

  it('accepts 24 models and refuses 25 with INVALID_LOOKUP before any request', async () => {
    const ok = lookup();
    const client = createXivapiClient(ok.options);
    // The 24 are the same model repeated: only the number of entries is limited.
    expect((await client.searchItems(new Array(24).fill(body))).status).toBe(
      'complete',
    );
    expect(ok.urls).toHaveLength(1);
    const over = lookup();
    await expect(
      createXivapiClient(over.options).searchItems(new Array(25).fill(body)),
    ).rejects.toMatchObject({
      name: 'XivapiInputError',
      code: 'INVALID_LOOKUP',
    });
    expect(over.fetch).not.toHaveBeenCalled();
  });

  it('asks for the slots in a fixed order, and shares one request between orders', async () => {
    const weapon: EquipmentModel = {
      slot: 'MainHand',
      set: 634,
      base: 19,
      variant: 1,
    };
    const run = lookup();
    const client = createXivapiClient(run.options);
    const [first, second] = await Promise.all([
      client.searchItems([weapon, body]),
      client.searchItems([body, weapon]),
    ]);
    expect(first.status).toBe('complete');
    expect(second.status).toBe('complete');
    expect(run.urls).toHaveLength(1);
    expect(run.urls[0]?.searchParams.get('query')).toBe(
      '+((+EquipSlotCategory.Body=1 +ModelMain=328041) (+EquipSlotCategory.MainHand=1 +ModelMain=4296213114))',
    );
  });

  it('applies the same limit to the resolver', async () => {
    const ok = lookup();
    const result = await createXivapiResolver(ok.options).resolve({
      models: new Array(24).fill(body),
    });
    expect(Object.keys(result.items)).toEqual(['Body']);
    const over = lookup();
    await expect(
      createXivapiResolver(over.options).resolve({
        models: new Array(25).fill(body),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_LOOKUP' });
    expect(over.fetch).not.toHaveBeenCalled();
  });

  it('refuses a list that is not an array, a model that cannot be keyed and two models for one slot', async () => {
    const client = createXivapiClient(lookup().options);
    for (const bad of [
      'Body',
      null,
      { length: 1, 0: body },
      [{ slot: 'Body', base: -1, variant: 0 }],
      [{ slot: 'Nowhere', base: 1, variant: 0 }],
      [null],
      [body, { ...body, variant: 6 }],
    ])
      await expect(client.searchItems(bad as never)).rejects.toMatchObject({
        code: 'INVALID_LOOKUP',
      });
  });
});

describe('the options a dye-name resolver accepts', () => {
  const create = (options: unknown) =>
    createDyeNameResolver(options as XivapiOptions);

  it.each([
    ['null', null],
    ['an array', []],
    ['an array holding options', [{ version: V }]],
    ['text', 'x'],
    ['a number', 1],
    ['a boolean', true],
    ['a function', () => undefined],
  ])('refuses %s with INVALID_OPTIONS', (_name, options) => {
    expect(() => create(options)).toThrow(
      expect.objectContaining({
        name: 'XivapiInputError',
        code: 'INVALID_OPTIONS',
      }),
    );
  });

  it('refuses an option whose getter throws, and every option it does not recognise as valid', () => {
    const hostile = Object.defineProperty({}, 'version', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(() => create(hostile)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTIONS' }),
    );
    expect(() => create({ version: '+ModelMain=1' })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTIONS' }),
    );
    expect(() => create({ cache: null })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTIONS' }),
    );
  });

  it('accepts no options at all, and an empty object', () => {
    expect(() => create(undefined)).not.toThrow();
    expect(() => create({})).not.toThrow();
  });

  it.each([null, [], 'x', 1])(
    'applies the same guard to the client and the resolver: %j',
    (options) => {
      expect(() => createXivapiClient(options as never)).toThrow(
        expect.objectContaining({ code: 'INVALID_OPTIONS' }),
      );
      expect(() => createXivapiResolver(options as never)).toThrow(
        expect.objectContaining({ code: 'INVALID_OPTIONS' }),
      );
    },
  );
});
