import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createLazyPaletteProvider,
  PaletteDataError,
} from '../src/palettes/default-provider.js';
import type { PaletteName, PaletteRequest } from '../src/palettes/index.js';
import {
  createDefaultPaletteProvider,
  PALETTE_METADATA,
} from '../src/palettes/index.js';

// What the palette provider returns for each gender, table and loader, from sources other than the
// provider's own loaders (the JSON files read directly, literal samples, and synthetic datasets in
// which every coordinate has its own color).

const TRIBES = [
  'Midlander',
  'Highlander',
  'Wildwood',
  'Duskwight',
  'Plainsfolk',
  'Dunesfolk',
  'SeekerOfTheSun',
  'KeeperOfTheMoon',
  'SeaWolf',
  'Hellsguard',
  'Raen',
  'Xaela',
  'Helions',
  'TheLost',
  'Rava',
  'Veena',
] as const;
const SHARED_LENGTHS: Record<string, number> = {
  eyes: 192,
  highlights: 192,
  features: 192,
  lipsDark: 96,
  lipsLight: 96,
  facePaintDark: 96,
  facePaintLight: 96,
};
// An index that must exist, for the compiler's sake (noUncheckedIndexedAccess).
const dig = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Missing palette entry.');
  return value;
};
const lengthOf = (palette: string): number => dig(SHARED_LENGTHS[palette]);
// biome-ignore lint/suspicious/noExplicitAny: bundled JSON read for comparison only
type Json = any;
const SHADER_NAMES = ['eyes', 'highlights', 'features', 'lipsDark'];

describe('the bundled data, read directly from its files', () => {
  const file = (name: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../src/palettes/data/${name}.json`, import.meta.url),
        'utf8',
      ),
    );
  const creatorShared: Json = file('creator-shared');
  const shaderShared: Json = file('shader-shared');
  const creatorRace: Json = file('creator-race');
  const shaderRace: Json = file('shader-race');
  const provider = createDefaultPaletteProvider();
  const hexOf = async (request: PaletteRequest) =>
    (await provider.getColor(request))?.hex;

  it('serves each shared palette from its own table', async () => {
    for (const palette of Object.keys(SHARED_LENGTHS))
      for (const index of [0, 1, lengthOf(palette) - 1])
        expect(
          await hexOf({
            table: 'creator',
            palette: palette as PaletteName,
            index,
          }),
          `creator ${palette} ${index}`,
        ).toBe(creatorShared[palette][index]);
    for (const palette of SHADER_NAMES)
      for (const index of [0, 1, lengthOf(palette) - 1])
        expect(
          await hexOf({
            table: 'shader',
            palette: palette as PaletteName,
            index,
          }),
          `shader ${palette} ${index}`,
        ).toBe(shaderShared[palette][index]);
  });
  it('shows that the creator and shader tables differ where the wiring could be crossed', () => {
    // If they were the same at the sampled entries, a loader wired to the wrong file would pass.
    for (const [palette, index] of [
      ['highlights', 0],
      ['features', 0],
      ['features', 100],
      ['lipsDark', 0],
      ['lipsDark', 50],
    ] as const)
      expect(creatorShared[palette][index]).not.toBe(
        shaderShared[palette][index],
      );
  });
  it.each([
    ['highlights', 0, '#F7F7F7', '#F6F6F6'],
    ['features', 0, '#F7F7F7', '#C6C6C6'],
    ['features', 100, '#7C2A3E', '#6D182D'],
    ['lipsDark', 0, '#F8F8F8', '#ADADAD'],
    ['lipsDark', 50, '#A13E67', '#5C2A48'],
    ['eyes', 150, '#222A39', '#222A39'],
  ] as const)(
    'returns %s %i as %s from the creator table and %s from the shader table',
    async (palette, index, creator, shader) => {
      expect(await hexOf({ table: 'creator', palette, index })).toBe(creator);
      expect(await hexOf({ table: 'shader', palette, index })).toBe(shader);
    },
  );
  it.each([
    ['lipsLight', 0, '#F8F8F8'],
    ['lipsLight', 95, '#393F21'],
    ['facePaintDark', 0, '#F8F8F8'],
    ['facePaintLight', 95, '#393F21'],
  ] as const)('returns creator %s %i as %s', async (palette, index, hex) => {
    expect(await hexOf({ table: 'creator', palette, index })).toBe(hex);
  });
  it('serves every tribe and both genders from the matching row of each race table', async () => {
    for (const [table, data] of [
      ['creator', creatorRace],
      ['shader', shaderRace],
    ] as const)
      for (const palette of ['skin', 'hair'] as const)
        for (const tribe of TRIBES)
          for (const [gender, row] of [
            ['Masculine', 'Male'],
            ['Feminine', 'Female'],
          ] as const)
            for (const index of [0, 42, 191])
              expect(
                await hexOf({ table, palette, index, tribe, gender }),
                `${table} ${palette} ${tribe} ${gender} ${index}`,
              ).toBe(data[palette][tribe][row][index]);
  });
  it('has genders that differ where the mapping could be inverted', () => {
    // Creator skin differs for 13 tribes; shader skin only for six.
    const differs = (data: Json, tribe: string) =>
      data.skin[tribe].Male.some(
        (hex: string, i: number) => hex !== data.skin[tribe].Female[i],
      );
    for (const tribe of [
      'Midlander',
      'Highlander',
      'Duskwight',
      'SeekerOfTheSun',
      'SeaWolf',
      'Veena',
    ])
      expect(differs(creatorRace, tribe), `creator ${tribe}`).toBe(true);
    for (const tribe of [
      'SeaWolf',
      'Hellsguard',
      'Raen',
      'Xaela',
      'Rava',
      'Veena',
    ])
      expect(differs(shaderRace, tribe), `shader ${tribe}`).toBe(true);
    for (const tribe of ['Midlander', 'Wildwood', 'Plainsfolk', 'Helions'])
      expect(differs(shaderRace, tribe), `shader ${tribe}`).toBe(false);
  });
  it.each([
    ['creator', 'SeaWolf', 'Masculine', '#EBF0DB'],
    ['creator', 'SeaWolf', 'Feminine', '#E1E4D2'],
    ['shader', 'SeaWolf', 'Masculine', '#ECF5E5'],
    ['shader', 'SeaWolf', 'Feminine', '#DBFAFC'],
  ] as const)(
    'returns %s skin 0 of %s %s as %s',
    async (table, tribe, gender, hex) => {
      expect(
        await hexOf({ table, palette: 'skin', index: 0, tribe, gender }),
      ).toBe(hex);
    },
  );
  it('reads the shader skin of the six tribes that have separate male and female rows', async () => {
    for (const tribe of [
      'SeaWolf',
      'Hellsguard',
      'Raen',
      'Xaela',
      'Rava',
      'Veena',
    ]) {
      const index = shaderRace.skin[tribe].Male.findIndex(
        (hex: string, i: number) => hex !== shaderRace.skin[tribe].Female[i],
      );
      expect(index, tribe).toBeGreaterThanOrEqual(0);
      const male = await hexOf({
        table: 'shader',
        palette: 'skin',
        index,
        tribe,
        gender: 'Masculine',
      });
      const female = await hexOf({
        table: 'shader',
        palette: 'skin',
        index,
        tribe,
        gender: 'Feminine',
      });
      expect(male).toBe(shaderRace.skin[tribe].Male[index]);
      expect(female).toBe(shaderRace.skin[tribe].Female[index]);
      expect(male).not.toBe(female);
    }
  });
  it('reads hair and skin from separate palettes', async () => {
    const [skin, hair] = await Promise.all([
      hexOf({
        table: 'creator',
        palette: 'skin',
        index: 0,
        tribe: 'Raen',
        gender: 'Feminine',
      }),
      hexOf({
        table: 'creator',
        palette: 'hair',
        index: 0,
        tribe: 'Raen',
        gender: 'Feminine',
      }),
    ]);
    expect(skin).toBe(creatorRace.skin.Raen.Female[0]);
    expect(hair).toBe(creatorRace.hair.Raen.Female[0]);
    expect(skin).not.toBe(hair);
  });
});

describe('the lookup itself, with a dataset in which every coordinate has its own color', () => {
  const TABLES = { creator: 0, shader: 1 } as const;
  const hex = (a: number, b: number, c: number) =>
    `#${[a, b, c]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`;
  const names = Object.keys(SHARED_LENGTHS);
  const sharedColor = (
    table: 'creator' | 'shader',
    palette: string,
    index: number,
  ) =>
    hex(
      0x10 + TABLES[table] * 0x80,
      0x10 + names.indexOf(palette) * 0x10,
      index,
    );
  const raceColor = (
    table: 'creator' | 'shader',
    palette: 'skin' | 'hair',
    tribe: number,
    row: 'Male' | 'Female',
    index: number,
  ) =>
    hex(
      0x20 +
        TABLES[table] * 0x40 +
        (palette === 'hair' ? 0x20 : 0) +
        (row === 'Female' ? 0x10 : 0),
      tribe * 0x10,
      index,
    );
  const shared = (table: 'creator' | 'shader') =>
    Object.fromEntries(
      (table === 'creator' ? names : SHADER_NAMES).map((palette) => [
        palette,
        Array.from({ length: lengthOf(palette) }, (_, i) =>
          sharedColor(table, palette, i),
        ),
      ]),
    );
  const race = (table: 'creator' | 'shader') =>
    Object.fromEntries(
      (['skin', 'hair'] as const).map((palette) => [
        palette,
        Object.fromEntries(
          TRIBES.map((tribe, t) => [
            tribe,
            {
              Male: Array.from({ length: 192 }, (_, i) =>
                raceColor(table, palette, t, 'Male', i),
              ),
              Female: Array.from({ length: 192 }, (_, i) =>
                raceColor(table, palette, t, 'Female', i),
              ),
            },
          ]),
        ),
      ]),
    );
  const synthetic = () =>
    createLazyPaletteProvider({
      'creator-shared': async () => shared('creator'),
      'shader-shared': async () => shared('shader'),
      'creator-race': async () => race('creator'),
      'shader-race': async () => race('shader'),
    });
  it('returns the matching color for every shared coordinate, and nothing outside them', async () => {
    const provider = synthetic();
    for (const table of ['creator', 'shader'] as const)
      for (const palette of table === 'creator' ? names : SHADER_NAMES) {
        const length = lengthOf(palette);
        for (let index = 0; index < length; index++) {
          const color = await provider.getColor({
            table,
            palette: palette as PaletteName,
            index,
          });
          expect(color?.hex, `${table} ${palette} ${index}`).toBe(
            sharedColor(table, palette, index),
          );
        }
        for (const index of [length, length + 1, -1])
          expect(
            await provider.getColor({
              table,
              palette: palette as PaletteName,
              index,
            }),
          ).toBeNull();
      }
    // The shader table has no light lips and no face paint.
    for (const palette of [
      'lipsLight',
      'facePaintDark',
      'facePaintLight',
    ] as const)
      expect(
        await provider.getColor({ table: 'shader', palette, index: 0 }),
      ).toBeNull();
  });
  it('returns the matching color for every tribe, gender, palette and table', async () => {
    const provider = synthetic();
    for (const table of ['creator', 'shader'] as const)
      for (const palette of ['skin', 'hair'] as const)
        for (const [t, tribe] of TRIBES.entries())
          for (const [gender, row] of [
            ['Masculine', 'Male'],
            ['Feminine', 'Female'],
          ] as const)
            for (let index = 0; index < 192; index++) {
              const color = await provider.getColor({
                table,
                palette,
                index,
                tribe,
                gender,
              });
              if (color?.hex !== raceColor(table, palette, t, row, index))
                throw new Error(
                  `${table} ${palette} ${tribe} ${gender} ${index}: ${color?.hex}`,
                );
            }
  });
  it('returns the coordinates it was asked for, an rgb that matches, and the dataset version', async () => {
    const color = await synthetic().getColor({
      table: 'shader',
      palette: 'skin',
      index: 7,
      tribe: 'Rava',
      gender: 'Feminine',
    });
    expect(color).toEqual({
      table: 'shader',
      palette: 'skin',
      index: 7,
      tribe: 'Rava',
      gender: 'Feminine',
      hex: raceColor('shader', 'skin', 14, 'Female', 7),
      rgb: [0x20 + 0x40 + 0x10, 14 * 0x10, 7],
      datasetVersion: PALETTE_METADATA.datasetVersion,
    });
  });
  it('refuses a race palette without a known tribe and gender, and index 192', async () => {
    const provider = synthetic();
    for (const request of [
      {
        table: 'creator',
        palette: 'skin',
        index: 192,
        tribe: 'Raen',
        gender: 'Feminine',
      },
      {
        table: 'creator',
        palette: 'skin',
        index: 0,
        tribe: 'Nobody',
        gender: 'Feminine',
      },
      {
        table: 'creator',
        palette: 'skin',
        index: 0,
        tribe: null,
        gender: 'Feminine',
      },
      {
        table: 'creator',
        palette: 'skin',
        index: 0,
        tribe: 'Raen',
        gender: null,
      },
      {
        table: 'creator',
        palette: 'skin',
        index: 0,
        tribe: 'Raen',
        gender: 'Male',
      },
      { table: 'creator', palette: 'skin', index: 0 },
    ] as PaletteRequest[])
      expect(
        await provider.getColor(request),
        JSON.stringify(request),
      ).toBeNull();
  });
});

describe('what a dataset must look like', () => {
  const colorList = (length: number) =>
    Array.from(
      { length },
      (_, i) => `#${i.toString(16).padStart(6, '0').toUpperCase()}`,
    );
  const sharedData = () =>
    Object.fromEntries(
      Object.entries(SHARED_LENGTHS).map(([name, n]) => [name, colorList(n)]),
    );
  const raceData = () =>
    Object.fromEntries(
      ['skin', 'hair'].map((palette) => [
        palette,
        Object.fromEntries(
          TRIBES.map((tribe) => [
            tribe,
            { Male: colorList(192), Female: colorList(192) },
          ]),
        ),
      ]),
    );
  // A dataset the tests take apart one piece at a time.
  // biome-ignore lint/suspicious/noExplicitAny: test data is edited without a schema
  type Data = Record<string, any>;
  const probe = (key: 'creator-shared' | 'creator-race', data: unknown) => {
    const provider = createLazyPaletteProvider({ [key]: async () => data });
    return key === 'creator-shared'
      ? provider.getColor({ table: 'creator', palette: 'eyes', index: 0 })
      : provider.getColor({
          table: 'creator',
          palette: 'skin',
          index: 0,
          tribe: 'Raen',
          gender: 'Feminine',
        });
  };
  const rejected = async (
    key: 'creator-shared' | 'creator-race',
    data: unknown,
  ) => {
    const error = await probe(key, data).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaletteDataError);
    expect(error).toMatchObject({
      name: 'PaletteDataError',
      code: 'PALETTE_LOAD_FAILED',
      message: 'Palette data could not be loaded.',
    });
  };
  it('accepts a well-formed dataset of each kind', async () => {
    expect((await probe('creator-shared', sharedData()))?.hex).toBe('#000000');
    expect((await probe('creator-race', raceData()))?.hex).toBe('#000000');
  });
  it.each(Object.keys(SHARED_LENGTHS))(
    'refuses a shared dataset without %s',
    async (name) => {
      const data: Data = sharedData();
      delete data[name];
      await rejected('creator-shared', data);
    },
  );
  it.each(Object.entries(SHARED_LENGTHS))(
    'refuses %s with one entry too few or too many',
    async (name, length) => {
      for (const n of [length - 1, length + 1, 0]) {
        const data: Data = sharedData();
        data[name] = colorList(n);
        await rejected('creator-shared', data);
      }
    },
  );
  it.each([
    ['a lowercase hex', '#abcdef'],
    ['a short hex', '#ABC'],
    ['a hex without #', 'ABCDEF'],
    ['a non-hex digit', '#GGGGGG'],
    ['trailing text', '#ABCDEF '],
    ['an eight digit hex', '#ABCDEF00'],
    ['a number', 0xabcdef],
    ['null', null],
    ['an object', { hex: '#ABCDEF' }],
    // These turn into a valid hex when the regular expression coerces them to text.
    ['an array holding a hex', ['#ABCDEF']],
    ['an object that turns into a hex', { toString: () => '#ABCDEF' }],
  ])('refuses an entry that is %s', async (_name, entry) => {
    for (const where of [0, 95, 191]) {
      const data: Data = sharedData();
      data.eyes[where] = entry;
      await rejected('creator-shared', data);
    }
  });
  it('refuses a palette that is not an array, and a dataset that is not a record', async () => {
    for (const bad of ['text', {}, null, 7]) {
      const data: Data = sharedData();
      data.eyes = bad;
      await rejected('creator-shared', data);
    }
    for (const bad of [null, [], 'x', 7, undefined])
      await rejected('creator-shared', bad);
  });
  it('refuses a dataset whose palettes are only inherited, or that is an array with properties', async () => {
    // Inherited names are not part of the data a loader returned.
    await rejected('creator-shared', Object.create(sharedData()));
    const oneInherited: Data = Object.create({ eyes: colorList(192) });
    for (const [name, list] of Object.entries(sharedData()))
      if (name !== 'eyes') oneInherited[name] = list;
    await rejected('creator-shared', oneInherited);
    await rejected('creator-shared', Object.assign([], sharedData()));
    await rejected('creator-race', Object.create(raceData()));
    await rejected('creator-race', Object.assign([], raceData()));
    // A palette that is an array carrying the tribes as properties.
    const arrayPalette: Data = raceData();
    arrayPalette.skin = Object.assign([], arrayPalette.skin);
    await rejected('creator-race', arrayPalette);
    // A tribe that only the palette's prototype has.
    const inheritedTribe: Data = raceData();
    const { Raen, ...otherTribes } = inheritedTribe.skin;
    inheritedTribe.skin = Object.assign(Object.create({ Raen }), otherTribes);
    await rejected('creator-race', inheritedTribe);
    // A tribe whose Male and Female rows are inherited.
    const inheritedRows: Data = raceData();
    inheritedRows.hair.Raen = Object.create(inheritedRows.hair.Raen);
    await rejected('creator-race', inheritedRows);
  });
  it('refuses a sparse array, whose holes an element check would skip', async () => {
    const holes = new Array(192);
    const data: Data = sharedData();
    data.eyes = holes;
    await rejected('creator-shared', data);
    const partly: Data = sharedData();
    partly.eyes = colorList(192);
    delete partly.eyes[100];
    await rejected('creator-shared', partly);
    const race: Data = raceData();
    delete race.skin.Raen.Female[7];
    await rejected('creator-race', race);
  });
  it.each(['skin', 'hair'])(
    'refuses a race dataset without %s, or with it as a non-record',
    async (palette) => {
      const missing: Data = raceData();
      delete missing[palette];
      await rejected('creator-race', missing);
      const wrong: Data = raceData();
      wrong[palette] = [];
      await rejected('creator-race', wrong);
    },
  );
  it.each(TRIBES)(
    'refuses a race dataset without the tribe %s',
    async (tribe) => {
      for (const palette of ['skin', 'hair']) {
        const data: Data = raceData();
        delete data[palette][tribe];
        await rejected('creator-race', data);
      }
    },
  );
  it('refuses a tribe without a male or female row, with a row of the wrong length, or with a non-record', async () => {
    for (const row of ['Male', 'Female']) {
      const missing: Data = raceData();
      delete missing.hair.Veena[row];
      await rejected('creator-race', missing);
      const short: Data = raceData();
      short.skin.Midlander[row] = colorList(191);
      await rejected('creator-race', short);
      const long: Data = raceData();
      long.skin.Midlander[row] = colorList(193);
      await rejected('creator-race', long);
    }
    const flat: Data = raceData();
    flat.skin.Raen = colorList(192);
    await rejected('creator-race', flat);
  });
  it('refuses a shader dataset that lacks one of its four palettes', async () => {
    for (const name of SHADER_NAMES) {
      const data: Data = sharedData();
      for (const extra of ['lipsLight', 'facePaintDark', 'facePaintLight'])
        delete data[extra];
      delete data[name];
      const provider = createLazyPaletteProvider({
        'shader-shared': async () => data,
      });
      await expect(
        provider.getColor({ table: 'shader', palette: 'eyes', index: 0 }),
      ).rejects.toBeInstanceOf(PaletteDataError);
    }
  });
});

describe('loading failures', () => {
  const eyes = { table: 'creator', palette: 'eyes', index: 0 } as const;
  const good = () =>
    Object.fromEntries(
      Object.entries(SHARED_LENGTHS).map(([name, n]) => [
        name,
        Array.from({ length: n }, () => '#112233'),
      ]),
    );
  it('reports a missing loader, a loader that throws and one that rejects with the same fixed error', async () => {
    for (const loaders of [
      {},
      {
        'creator-shared': () => {
          throw new Error('SECRET path C:/private');
        },
      },
      {
        'creator-shared': async () => {
          throw new Error('SECRET path C:/private');
        },
      },
      {
        'creator-shared': () =>
          Promise.reject(new Error('SECRET path C:/private')),
      },
    ] as Parameters<typeof createLazyPaletteProvider>[0][]) {
      const error = await createLazyPaletteProvider(loaders)
        .getColor(eyes)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PaletteDataError);
      expect(error).toMatchObject({
        code: 'PALETTE_LOAD_FAILED',
        message: 'Palette data could not be loaded.',
      });
      expect(String(error) + JSON.stringify(error)).not.toContain('SECRET');
      expect((error as Error).cause).toBeUndefined();
    }
  });
  it('tries again after a failure instead of remembering it', async () => {
    let calls = 0;
    const provider = createLazyPaletteProvider({
      'creator-shared': async () => {
        if (++calls === 1) throw new Error('first try');
        return good();
      },
    });
    await expect(provider.getColor(eyes)).rejects.toBeInstanceOf(
      PaletteDataError,
    );
    expect((await provider.getColor(eyes))?.hex).toBe('#112233');
    expect(calls).toBe(2);
  });
  it('tries again after a dataset fails validation instead of remembering that', async () => {
    const sparse = new Array(192);
    for (const broken of [
      { ...good(), eyes: [] },
      { ...good(), eyes: sparse },
      null,
    ]) {
      let calls = 0;
      const provider = createLazyPaletteProvider({
        'creator-shared': async () => (++calls === 1 ? broken : good()),
      });
      await expect(provider.getColor(eyes)).rejects.toBeInstanceOf(
        PaletteDataError,
      );
      expect((await provider.getColor(eyes))?.hex).toBe('#112233');
      expect(calls).toBe(2);
    }
  });
  it('loads a dataset once for concurrent and later requests', async () => {
    const load = vi.fn(async () => good());
    const provider = createLazyPaletteProvider({ 'creator-shared': load });
    await Promise.all([
      provider.getColor(eyes),
      provider.getColor({ ...eyes, index: 1 }),
      provider.getColor({ ...eyes, palette: 'features' }),
    ]);
    await provider.getColor({ ...eyes, index: 2 });
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('does not load anything for a request it can refuse', async () => {
    const load = vi.fn(async () => good());
    const provider = createLazyPaletteProvider({
      'creator-shared': load,
      'shader-shared': load,
      'creator-race': load,
      'shader-race': load,
    });
    const raen = {
      table: 'creator',
      palette: 'skin',
      index: 0,
      tribe: 'Raen',
      gender: 'Feminine',
    } as const;
    const refused: [string, unknown][] = [
      ['an index at the end of a shared palette', { ...eyes, index: 192 }],
      ['a negative index', { ...eyes, index: -1 }],
      ['an unknown palette', { ...eyes, palette: 'nope' }],
      [
        'a palette that is a property of every object',
        { ...eyes, palette: 'constructor' },
      ],
      ['a palette named __proto__', { ...eyes, palette: '__proto__' }],
      ['an unknown table', { ...eyes, table: 'nope' }],
      [
        'a palette the shader table does not have',
        { table: 'shader', palette: 'lipsLight', index: 0 },
      ],
      ['an index written as text', { ...eyes, index: '0' }],
      ['an index in an array', { ...eyes, index: [0] }],
      ['a fractional index', { ...eyes, index: 0.5 }],
      ['an index that is NaN', { ...eyes, index: Number.NaN }],
      ['an infinite index', { ...eyes, index: Infinity }],
      ['no index', { table: 'creator', palette: 'eyes' }],
      ['an index at the end of a race palette', { ...raen, index: 192 }],
      ['an index beyond the end of a race palette', { ...raen, index: 193 }],
      ['a race index written as text', { ...raen, index: '0' }],
      ['a fractional race index', { ...raen, index: 0.5 }],
      ['an unknown tribe', { ...raen, tribe: 'Nobody' }],
      [
        'a tribe that is a property of every object',
        { ...raen, tribe: 'constructor' },
      ],
      ['a tribe named __proto__', { ...raen, tribe: '__proto__' }],
      ['a tribe in lower case', { ...raen, tribe: 'raen' }],
      ['no tribe', { ...raen, tribe: undefined }],
      ['no gender', { ...raen, gender: undefined }],
      ['a null gender', { ...raen, gender: null }],
      [
        'the stored word Male instead of the gender name',
        { ...raen, gender: 'Male' },
      ],
      ['a gender in lower case', { ...raen, gender: 'feminine' }],
      ['a null request', null],
      ['a request that is text', 'eyes'],
      ['a request that is an array', [eyes]],
    ];
    for (const [name, request] of refused)
      expect(
        await provider.getColor(request as PaletteRequest),
        name,
      ).toBeNull();
    expect(load).not.toHaveBeenCalled();
    // The same provider does load for a request that is allowed (the data given here is not a race
    // dataset, so the load fails), which shows that the spy is wired up.
    await provider.getColor(raen).catch(() => null);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('the provenance record', () => {
  const frozenEverywhere = (value: unknown, path: string): string[] => {
    if (typeof value !== 'object' || value === null) return [];
    return [
      ...(Object.isFrozen(value) ? [] : [path]),
      ...Object.entries(value).flatMap(([key, child]) =>
        frozenEverywhere(child, `${path}.${key}`),
      ),
    ];
  };
  it('is frozen at every depth, not only at the top', () => {
    expect(frozenEverywhere(PALETTE_METADATA, 'metadata')).toEqual([]);
    expect(Object.isFrozen(PALETTE_METADATA.source)).toBe(true);
    expect(PALETTE_METADATA.artifacts).toHaveLength(4);
    expect(Object.isFrozen(PALETTE_METADATA.artifacts)).toBe(true);
    for (const artifact of PALETTE_METADATA.artifacts)
      expect(Object.isFrozen(artifact)).toBe(true);
    for (const source of PALETTE_METADATA.sources)
      expect(Object.isFrozen(source)).toBe(true);
    if (PALETTE_METADATA.generatedFrom)
      expect(Object.isFrozen(PALETTE_METADATA.generatedFrom)).toBe(true);
  });
  it('cannot be changed at any depth', () => {
    expect(() => {
      (PALETTE_METADATA.source as { commit: string }).commit = 'x';
    }).toThrow();
    expect(() => {
      dig(
        (PALETTE_METADATA.artifacts as unknown as { file: string }[])[0],
      ).file = 'x';
    }).toThrow();
    expect(() => {
      (PALETTE_METADATA.artifacts as unknown as unknown[]).push({});
    }).toThrow();
    if (PALETTE_METADATA.sources[0])
      expect(() => {
        dig(
          (PALETTE_METADATA.sources as unknown as { path: string }[])[0],
        ).path = 'x';
      }).toThrow();
  });
  it('is the very object a provider reports', () => {
    expect(createDefaultPaletteProvider().metadata).toBe(PALETTE_METADATA);
    expect(createLazyPaletteProvider({}).metadata).toBe(PALETTE_METADATA);
  });
});
