import { describe, expect, it } from 'vitest';
import { generatePaletteTables } from '../../../scripts/palette-generation.js';

// A source file in which every 4-byte entry holds its own index (and so its own color) shows exactly
// which entry each palette position was read from. The expected positions below are the layout that
// reproduces the committed artifact hashes against the maintainer's real human.cmp, written out in
// full: the offset of each shared palette, the clan and gender blocks of 1280 entries, and the
// offset of skin and hair within a block, where shader hair takes every other entry.

const ENTRIES = 182_272 / 4;
const bytes = new Uint8Array(ENTRIES * 4);
for (let entry = 0; entry < ENTRIES; entry++)
  bytes.set([entry & 0xff, (entry >> 8) & 0xff, entry >> 16, 255], entry * 4);
const colorOf = (entry: number) =>
  `#${[entry & 0xff, (entry >> 8) & 0xff, entry >> 16]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
const tables = generatePaletteTables(bytes);
// An index that must exist, for the compiler's sake (noUncheckedIndexedAccess).
const dig = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Missing palette entry.');
  return value;
};

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
];
// Where each shared palette starts within its half of the file, and how long it is.
const SHARED: [string, number, number][] = [
  ['eyes', 0, 192],
  ['highlights', 256, 192],
  ['lipsDark', 512, 96],
  ['facePaintDark', 640, 96],
  ['features', 768, 192],
  ['lipsLight', 1024, 96],
  ['facePaintLight', 1152, 96],
];
const CREATOR_HALF = 2304;
const RACE_START = 4608;
const BLOCK = 1280;

describe('the shared palettes', () => {
  it.each(SHARED)(
    'reads the creator %s from entry %i of the creator half, %i colors',
    (name, offset, length) => {
      const palette = dig(
        (tables['creator-shared'] as Record<string, string[]>)[name],
      );
      expect(palette).toHaveLength(length);
      for (let i = 0; i < length; i++)
        expect(palette[i], `${name} ${i}`).toBe(
          colorOf(CREATOR_HALF + offset + i),
        );
    },
  );
  it.each(
    SHARED.filter(([name]) =>
      ['eyes', 'highlights', 'lipsDark', 'features'].includes(name),
    ),
  )('reads the shader %s from entry %i, %i colors', (name, offset, length) => {
    const palette = dig(
      (tables['shader-shared'] as Record<string, string[]>)[name],
    );
    expect(palette).toHaveLength(length);
    for (let i = 0; i < length; i++)
      expect(palette[i], `${name} ${i}`).toBe(colorOf(offset + i));
  });
  it('has exactly the palettes of each table', () => {
    expect(Object.keys(tables['creator-shared']).sort()).toEqual(
      SHARED.map(([name]) => name).sort(),
    );
    expect(Object.keys(tables['shader-shared']).sort()).toEqual([
      'eyes',
      'features',
      'highlights',
      'lipsDark',
    ]);
  });
  it('keeps highlights and features apart in both tables (their offsets must not be swapped)', () => {
    type Pair = { highlights: string[]; features: string[] };
    const creator = tables['creator-shared'] as unknown as Pair;
    const shader = tables['shader-shared'] as unknown as Pair;
    expect(creator.highlights[0]).toBe(colorOf(CREATOR_HALF + 256));
    expect(creator.features[0]).toBe(colorOf(CREATOR_HALF + 768));
    expect(shader.highlights[0]).toBe(colorOf(256));
    expect(shader.features[0]).toBe(colorOf(768));
  });
});

describe('the race palettes, for all 16 tribes and both genders', () => {
  type Dict = Record<string, Record<string, string[]>>;
  type Race = { skin: Dict; hair: Dict };
  const creator = tables['creator-race'] as unknown as Race;
  const shader = tables['shader-race'] as unknown as Race;
  const colorsOf = (
    table: Race,
    palette: 'skin' | 'hair',
    tribe: string,
    gender: string,
  ) => dig(dig(table[palette][tribe])[gender]);
  const rows = TRIBES.flatMap((tribe, clan) =>
    (['Male', 'Female'] as const).map((gender, g) => ({
      tribe,
      gender,
      base: RACE_START + (clan * 2 + g) * BLOCK,
    })),
  );
  it('has 32 blocks, ordered by clan and then by gender, as the tribes are in the table', () => {
    expect(rows).toHaveLength(32);
    expect(Object.keys(creator.skin)).toEqual(TRIBES);
    expect(Object.keys(shader.hair)).toEqual(TRIBES);
    for (const tribe of TRIBES)
      expect(Object.keys(dig(creator.skin[tribe]))).toEqual(['Male', 'Female']);
  });
  it.each(rows.map((row) => [row.tribe, row.gender, row.base] as const))(
    '%s %s: block starting at entry %i',
    (tribe, gender, base) => {
      const expected = {
        'creator skin': (i: number) => base + 768 + i,
        'creator hair': (i: number) => base + 1024 + i,
        'shader skin': (i: number) => base + i,
        // Shader hair takes every other entry; the ones between are sheen.
        'shader hair': (i: number) => base + 256 + 2 * i,
      };
      const actual = {
        'creator skin': colorsOf(creator, 'skin', tribe, gender),
        'creator hair': colorsOf(creator, 'hair', tribe, gender),
        'shader skin': colorsOf(shader, 'skin', tribe, gender),
        'shader hair': colorsOf(shader, 'hair', tribe, gender),
      };
      for (const [name, position] of Object.entries(expected)) {
        const colors = actual[name as keyof typeof actual];
        expect(colors, name).toHaveLength(192);
        for (let i = 0; i < 192; i++)
          if (colors[i] !== colorOf(position(i)))
            throw new Error(
              `${name} ${tribe} ${gender} ${i}: got ${colors[i]}, expected entry ${position(i)}`,
            );
      }
    },
  );
  it('uses no source entry twice within a table, and none outside the file', () => {
    const entries = (table: Race) => {
      const seen = new Set<string>();
      for (const palette of ['skin', 'hair'])
        for (const tribe of TRIBES)
          for (const gender of ['Male', 'Female'])
            for (const hex of dig(
              dig(table[palette as 'skin'][tribe])[gender],
            )) {
              expect(
                seen.has(hex),
                `${palette} ${tribe} ${gender} ${hex}`,
              ).toBe(false);
              seen.add(hex);
            }
      return seen.size;
    };
    expect(entries(creator)).toBe(2 * 32 * 192);
    expect(entries(shader)).toBe(2 * 32 * 192);
    const last = RACE_START + 31 * BLOCK + 1024 + 191;
    expect(last).toBeLessThan(ENTRIES);
  });
});

describe('the shape of the output', () => {
  it('has no inherited keys that a consumer could trip over', () => {
    for (const table of Object.values(tables))
      expect(Object.getPrototypeOf(table)).toBeNull();
    expect(Object.getPrototypeOf(tables['creator-race'].skin)).toBeNull();
    expect(
      Object.getPrototypeOf(dig(tables['creator-race'].skin?.Raen)),
    ).toBeNull();
  });
  it('writes every color as an uppercase #RRGGBB, ignoring the fourth byte', () => {
    const odd = new Uint8Array(182_272);
    odd.set([0xab, 0xcd, 0xef, 0x12], 0);
    expect(dig(generatePaletteTables(odd)['shader-shared'].eyes)[0]).toBe(
      '#ABCDEF',
    );
  });
  it('totals 26,208 colors across the four tables', () => {
    const count = (value: unknown): number =>
      Array.isArray(value)
        ? value.length
        : Object.values(value as object).reduce(
            (sum: number, v) => sum + count(v),
            0,
          );
    expect(
      Object.values(tables).reduce((sum, table) => sum + count(table), 0),
    ).toBe(26_208);
  });
});
