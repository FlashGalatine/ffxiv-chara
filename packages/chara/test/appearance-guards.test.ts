import { describe, expect, it } from 'vitest';
import { resolveAppearance } from '../src/appearance/index.js';
import { inspectChara, readChara } from '../src/index.js';
import type {
  PaletteColor,
  PaletteProvider,
  PaletteRequest,
} from '../src/palettes/index.js';

// Guards of resolveAppearance that the lenient shared mock in appearance.test.ts cannot show: a
// provider that gives every palette entry its own color, one that answers with a wrong association,
// and the boundaries of the index ranges.

const gamma = (hex: string) =>
  hex
    .slice(1)
    .match(/../g)
    ?.map((value) => (Number.parseInt(value, 16) / 255) ** 2)
    .join(', ') as string;
const inspect = (fields: object) =>
  inspectChara(readChara(JSON.stringify({ Hair: 0, ...fields })));
const asRgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];
/** A color for a request that no other request shares: routing to a wrong palette changes it. */
const unique = (() => {
  const seen = new Map<string, string>();
  return (request: PaletteRequest): string => {
    const key = JSON.stringify([
      request.table,
      request.palette,
      request.index,
      request.tribe ?? null,
      request.gender ?? null,
    ]);
    let hex = seen.get(key);
    if (!hex) {
      const n = (seen.size + 1) * 40_503;
      hex = `#${(n % 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
      seen.set(key, hex);
    }
    return hex;
  };
})();
const color = (request: PaletteRequest, hex: string): PaletteColor => ({
  ...request,
  hex,
  rgb: asRgb(hex),
  datasetVersion: 'synthetic-test',
});
const recording = () => {
  const requests: PaletteRequest[] = [];
  const provider: PaletteProvider = {
    async getColor(request) {
      requests.push({ ...request });
      return color(request, unique(request));
    },
  };
  return { provider, requests };
};
const resolve = (fields: object, provider: PaletteProvider) =>
  resolveAppearance(inspect(fields), { palettes: provider });

describe('which palette each slot is read from', () => {
  const identity = { Tribe: 'Raen', Gender: 'Feminine' };
  const request = (
    table: 'creator' | 'shader',
    palette: PaletteRequest['palette'],
    index: number,
    race = false,
  ): PaletteRequest => ({
    table,
    palette,
    index,
    ...(race
      ? { tribe: 'Raen', gender: 'Feminine' }
      : { tribe: 'Raen', gender: 'Feminine' }),
  });
  // Eyes, highlights and features are not gendered, but the identity is passed along unchanged.
  const fields = {
    ...identity,
    LEyeColor: 11,
    REyeColor: 12,
    HairTone: 13,
    Highlights: 14,
    Skintone: 15,
    LimbalEyes: 16,
    LipsToneFurPattern: 17,
    Mouth: 0x80,
    FacePaintColor: 18,
    FacePaint: 1,
    EnableHighlights: true,
  };
  it('reads each slot from its own palette, creator and shader, with the stored index', async () => {
    const { provider, requests } = recording();
    const result = await resolve(fields, provider);
    const expected: [string, PaletteRequest, PaletteRequest | null][] = [
      [
        'leftEye',
        request('creator', 'eyes', 11),
        request('shader', 'eyes', 11),
      ],
      [
        'rightEye',
        request('creator', 'eyes', 12),
        request('shader', 'eyes', 12),
      ],
      [
        'hair',
        request('creator', 'hair', 13, true),
        request('shader', 'hair', 13, true),
      ],
      [
        'highlights',
        request('creator', 'highlights', 14),
        request('shader', 'highlights', 14),
      ],
      [
        'skin',
        request('creator', 'skin', 15, true),
        request('shader', 'skin', 15, true),
      ],
      [
        'limbal',
        request('creator', 'features', 16),
        request('shader', 'features', 16),
      ],
      [
        'lip',
        request('creator', 'lipsDark', 17),
        request('shader', 'lipsDark', 17),
      ],
      ['facePaint', request('creator', 'facePaintDark', 18), null],
    ];
    for (const [slot, creator, shader] of expected) {
      const entry = result.slots[slot as keyof typeof result.slots];
      expect(entry.creatorHex, `${slot} creator`).toBe(unique(creator));
      expect(entry.shaderHex, `${slot} shader`).toBe(
        shader ? unique(shader) : null,
      );
    }
    // Nothing else was asked for.
    expect(requests).toHaveLength(15);
  });
  it('tells the highlights palette from the features palette (they must not be swapped)', async () => {
    const { provider } = recording();
    const result = await resolve(
      { ...identity, Highlights: 5, LimbalEyes: 5, EnableHighlights: true },
      provider,
    );
    expect(result.slots.highlights.creatorHex).not.toBe(
      result.slots.limbal.creatorHex,
    );
    expect(result.slots.highlights.creatorHex).toBe(
      unique(request('creator', 'highlights', 5)),
    );
    expect(result.slots.limbal.creatorHex).toBe(
      unique(request('creator', 'features', 5)),
    );
  });
  it.each([
    [95, 'lipsDark', 95, 'dark'],
    [128, 'lipsLight', 0, 'light'],
    [223, 'lipsLight', 95, 'light'],
  ])(
    'reads lip index %i from %s entry %i',
    async (index, palette, sheet, variant) => {
      const { provider } = recording();
      const result = await resolve(
        { ...identity, Mouth: 0x80, LipsToneFurPattern: index },
        provider,
      );
      expect(result.slots.lip).toMatchObject({ variant, sheetIndex: sheet });
      expect(result.slots.lip.creatorHex).toBe(
        unique(request('creator', palette as 'lipsDark', sheet)),
      );
      // The shader table only has the dark lips, at the same entry.
      expect(result.slots.lip.shaderHex).toBe(
        unique(request('shader', 'lipsDark', sheet)),
      );
    },
  );
  it.each([
    [95, 'facePaintDark', 95, 'dark'],
    [128, 'facePaintLight', 0, 'light'],
    [223, 'facePaintLight', 95, 'light'],
  ])(
    'reads face paint color %i from %s entry %i',
    async (index, palette, sheet, variant) => {
      const { provider } = recording();
      const result = await resolve(
        { ...identity, FacePaint: 1, FacePaintColor: index },
        provider,
      );
      expect(result.slots.facePaint).toMatchObject({
        variant,
        sheetIndex: sheet,
      });
      expect(result.slots.facePaint.creatorHex).toBe(
        unique(request('creator', palette as 'facePaintDark', sheet)),
      );
      expect(result.slots.facePaint.shaderHex).toBeNull();
    },
  );
});

describe('answers from a provider that do not belong to the request', () => {
  const fields = {
    Tribe: 'Raen',
    Gender: 'Feminine',
    HairTone: 7,
    Skintone: 3,
    LEyeColor: 3,
  };
  // Hair and skin are the two palettes that belong to a tribe and a gender.
  const BELONGING = [
    ['hair', 'HairTone'],
    ['skin', 'Skintone'],
  ] as const;
  const wrongWith = (
    change: (c: PaletteColor) => unknown,
    only?: 'creator' | 'shader',
  ) =>
    ({
      async getColor(request) {
        const answer = color(request, '#ABCDEF');
        return only && request.table !== only
          ? answer
          : (change(answer) as PaletteColor);
      },
    }) satisfies PaletteProvider;
  const bad: [string, (c: PaletteColor) => unknown][] = [
    [
      'the wrong table',
      (c) => ({ ...c, table: c.table === 'creator' ? 'shader' : 'creator' }),
    ],
    [
      'the wrong palette',
      (c) => ({ ...c, palette: c.palette === 'hair' ? 'skin' : 'hair' }),
    ],
    ['the wrong index', (c) => ({ ...c, index: c.index + 1 })],
    ['the wrong tribe', (c) => ({ ...c, tribe: 'Xaela' })],
    ['the wrong gender', (c) => ({ ...c, gender: 'Masculine' })],
    ['no tribe', (c) => ({ ...c, tribe: undefined })],
    ['no gender', (c) => ({ ...c, gender: undefined })],
    ['a lowercase hex', (c) => ({ ...c, hex: '#abcdef' })],
    ['a mixed-case hex', (c) => ({ ...c, hex: '#AbCdEf' })],
    ['a hex without #', (c) => ({ ...c, hex: 'ABCDEF' })],
    ['a short hex', (c) => ({ ...c, hex: '#ABC' })],
    ['an eight digit hex', (c) => ({ ...c, hex: '#ABCDEF00' })],
    ['a functional color', (c) => ({ ...c, hex: 'rgb(1,2,3)' })],
    ['a hex after other text', (c) => ({ ...c, hex: 'x#ABCDEF' })],
    ['a hex with a leading space', (c) => ({ ...c, hex: ' #ABCDEF' })],
    ['a hex with a trailing space', (c) => ({ ...c, hex: '#ABCDEF ' })],
    ['a hex with a trailing line break', (c) => ({ ...c, hex: '#ABCDEF\n' })],
    ['letters that are not hex digits', (c) => ({ ...c, hex: '#GHIJKL' })],
    ['a hex that is not text', (c) => ({ ...c, hex: 0xabcdef })],
    // These turn into a valid hex when the regular expression coerces them to text.
    ['an array holding a hex', (c) => ({ ...c, hex: ['#ABCDEF'] })],
    [
      'an object that turns into a hex',
      (c) => ({ ...c, hex: { toString: () => '#ABCDEF' } }),
    ],
    ['no hex', (c) => ({ ...c, hex: undefined })],
    ['undefined', () => undefined],
    ['a string', () => 'ABCDEF'],
    ['a number', () => 0xabcdef],
    ['an empty object', () => ({})],
  ];
  it.each(
    BELONGING.flatMap(([slot, field]) =>
      bad.map(([name, change]) => [slot, name, field, change] as const),
    ),
  )(
    'the %s slot refuses an answer with %s, creating no color',
    async (slot, _name, field, change) => {
      const result = await resolve(fields, wrongWith(change));
      expect(result.slots[slot]).toMatchObject({
        creatorHex: null,
        shaderHex: null,
        reason: 'missingPaletteEntry',
        interpretation: 'unresolved',
        displayHex: null,
      });
      // One issue for the creator answer and one for the shader answer, on the slot's own field.
      expect(
        result.issues.filter(
          (issue) =>
            issue.code === 'INVALID_PALETTE_RESPONSE' &&
            issue.path[0] === field,
        ),
      ).toEqual([
        expect.objectContaining({
          code: 'INVALID_PALETTE_RESPONSE',
          path: [field],
        }),
        expect.objectContaining({
          code: 'INVALID_PALETTE_RESPONSE',
          path: [field],
        }),
      ]);
    },
  );
  it('checks the shader answer on its own', async () => {
    const result = await resolve(
      fields,
      wrongWith((c) => ({ ...c, index: 99 }), 'shader'),
    );
    expect(result.slots.hair).toMatchObject({
      creatorHex: '#ABCDEF',
      shaderHex: null,
    });
    expect(
      result.issues
        .filter((issue) => issue.path[0] === 'HairTone')
        .map((issue) => issue.code),
    ).toEqual(['INVALID_PALETTE_RESPONSE']);
  });
  it('does not check tribe and gender for a palette that has none (eyes)', async () => {
    const result = await resolve(
      fields,
      wrongWith((c) => ({ ...c, tribe: 'Xaela', gender: 'Masculine' })),
    );
    expect(result.slots.leftEye).toMatchObject({
      creatorHex: '#ABCDEF',
      shaderHex: '#ABCDEF',
    });
    expect(
      result.issues.filter((issue) => issue.path[0] === 'LEyeColor'),
    ).toEqual([]);
  });
  it('accepts a correct association with an uppercase hex', async () => {
    const result = await resolve(
      fields,
      wrongWith((c) => c),
    );
    expect(result.slots.hair).toMatchObject({
      creatorHex: '#ABCDEF',
      shaderHex: '#ABCDEF',
    });
    expect(result.issues).toEqual([]);
  });
  it('treats null as a missing entry, without an issue', async () => {
    const result = await resolve(fields, { getColor: async () => null });
    expect(result.slots.hair).toMatchObject({
      creatorHex: null,
      reason: 'missingPaletteEntry',
    });
    expect(result.slots.leftEye.reason).toBe('missingPaletteEntry');
    expect(result.issues).toEqual([]);
  });
  it('turns an error thrown before a promise is returned into the same fixed issue', async () => {
    const result = await resolve(fields, {
      getColor() {
        throw new Error('SECRET internal detail');
      },
    });
    expect(result.issues.map((issue) => issue.code)).toContain(
      'PALETTE_UNAVAILABLE',
    );
    expect(JSON.stringify(result.issues)).not.toContain('SECRET');
    expect(result.slots.hair.creatorHex).toBeNull();
  });
  it('turns a thrown error into a fixed issue', async () => {
    const result = await resolve(fields, {
      getColor: async () => {
        throw new Error('SECRET internal detail');
      },
    });
    expect(result.issues.map((issue) => issue.code)).toContain(
      'PALETTE_UNAVAILABLE',
    );
    expect(JSON.stringify(result.issues)).not.toContain('SECRET');
    expect(result.slots.hair.creatorHex).toBeNull();
  });
});

describe('the all-zero extended block', () => {
  const ZERO = '0, 0, 0';
  const block = {
    SkinColor: ZERO,
    LeftEyeColor: ZERO,
    RightEyeColor: ZERO,
    LimbalRingColor: ZERO,
    HairColor: ZERO,
    HairHighlight: ZERO,
    MouthColor: '0, 0, 0, 0',
  };
  const KEYS = Object.keys(block) as (keyof typeof block)[];
  const ambiguous = async (fields: object) =>
    (await resolve(fields, recording().provider)).issues.some(
      (issue) => issue.code === 'AMBIGUOUS_ZERO_BLOCK',
    );
  it('is ambiguous with the validity flag true, false, null or absent', async () => {
    for (const flag of [true, false, null, undefined]) {
      const fields =
        flag === undefined
          ? block
          : { ...block, IsExtendedAppearanceValid: flag };
      expect(await ambiguous(fields), String(flag)).toBe(true);
    }
  });
  it.each(KEYS)('needs %s to be zero as well', async (key) => {
    expect(await ambiguous({ ...block, [key]: undefined })).toBe(false);
    expect(await ambiguous({ ...block, [key]: 'x' })).toBe(false);
    expect(await ambiguous({ ...block, [key]: null })).toBe(false);
    const lane = key === 'MouthColor' ? '0, 0, 0, 0.001' : '0, 0, 0.001';
    expect(await ambiguous({ ...block, [key]: lane })).toBe(false);
    // And every other key keeps the block ambiguous when only this one is zero.
    expect(await ambiguous(block)).toBe(true);
  });
  it('needs every channel of a key, the alpha channel included', async () => {
    expect(await ambiguous({ ...block, MouthColor: '0, 0, 0, 1' })).toBe(false);
    expect(await ambiguous({ ...block, SkinColor: '1, 0, 0' })).toBe(false);
    expect(await ambiguous({ ...block, SkinColor: '0, 1, 0' })).toBe(false);
  });
  it('does not make any slot live, even when the flag says the block is valid', async () => {
    const result = await resolve(
      {
        ...block,
        LEyeColor: 0,
        HairTone: 0,
        Tribe: 'Raen',
        Gender: 'Feminine',
        IsExtendedAppearanceValid: true,
      },
      recording().provider,
    );
    expect(result.slots.leftEye.extendedActive).toBe(false);
    expect(result.slots.leftEye.reason).toBe('ambiguousZeroBlock');
    expect(result.slots.hair.extendedActive).toBe(false);
    const notZero = await resolve(
      {
        ...block,
        SkinColor: '0.1, 0, 0',
        LEyeColor: 0,
        IsExtendedAppearanceValid: true,
      },
      recording().provider,
    );
    expect(notZero.slots.leftEye.extendedActive).toBe(true);
  });
  it('does not switch the lip off because its opacity is zero', async () => {
    const result = await resolve(
      {
        ...block,
        Tribe: 'Raen',
        Gender: 'Feminine',
        Mouth: 0x80,
        LipsToneFurPattern: 6,
        IsExtendedAppearanceValid: true,
      },
      recording().provider,
    );
    // The zero opacity belongs to a block that cannot be read, so the lip keeps its palette color.
    expect(result.slots.lip).toMatchObject({
      interpretation: 'palette',
      reason: 'ambiguousZeroBlock',
      extendedActive: false,
    });
    expect(result.slots.lip.displayHex).not.toBeNull();
    expect(result.slots.lip.lipComposite).toBeNull();
  });
});

describe('index ranges, grid addresses and slot kinds', () => {
  const identity = { Tribe: 'Raen', Gender: 'Feminine' };
  const slots: [string, string, string][] = [
    ['leftEye', 'LEyeColor', 'eyes'],
    ['rightEye', 'REyeColor', 'eyes'],
    ['hair', 'HairTone', 'hair'],
    ['skin', 'Skintone', 'skin'],
    ['limbal', 'LimbalEyes', 'features'],
    ['highlights', 'Highlights', 'highlights'],
  ];
  it.each(slots)(
    '%s: index 191 is the last entry, 192 is out of range (%s)',
    async (slot, key, palette) => {
      const { provider, requests } = recording();
      const extra = slot === 'highlights' ? { EnableHighlights: true } : {};
      const last = await resolve(
        { ...identity, ...extra, [key]: 191 },
        provider,
      );
      expect(last.slots[slot as 'hair']).toMatchObject({
        sheetIndex: 191,
        reason: 'paletteOnly',
      });
      expect(
        requests.filter((r) => r.palette === palette).map((r) => r.index),
      ).toEqual([191, 191]);
      requests.length = 0;
      const over = await resolve(
        { ...identity, ...extra, [key]: 192 },
        provider,
      );
      expect(over.slots[slot as 'hair']).toMatchObject({
        reason: 'indexOutOfRange',
        creatorHex: null,
        sheetIndex: null,
      });
      expect(over.issues).toEqual([
        expect.objectContaining({
          code: 'PALETTE_INDEX_OUT_OF_RANGE',
          path: [key],
        }),
      ]);
      expect(requests).toEqual([]);
    },
  );
  it.each([
    [95, 'dark', 95],
    [96, null, null],
    [127, null, null],
    [128, 'light', 0],
    [223, 'light', 95],
    [224, null, null],
    [255, null, null],
  ])('lip index %i: variant %s', async (index, variant, sheet) => {
    const result = await resolve(
      { ...identity, Mouth: 0x80, LipsToneFurPattern: index },
      recording().provider,
    );
    expect(result.slots.lip.variant).toBe(variant);
    expect(result.slots.lip.sheetIndex).toBe(sheet);
    expect(result.slots.lip.reason).toBe(
      variant ? 'paletteOnly' : 'indexOutOfRange',
    );
  });
  it.each([
    [0, 'R1·C1'],
    [7, 'R1·C8'],
    [8, 'R2·C1'],
    [63, 'R8·C8'],
    [64, 'R9·C1'],
    [191, 'R24·C8'],
  ])('addresses index %i as %s on the grid', async (index, address) => {
    const result = await resolve(
      { ...identity, LEyeColor: index },
      recording().provider,
    );
    expect(result.slots.leftEye.gridAddress).toBe(address);
    expect(result.slots.leftEye.sheetIndex).toBe(index);
  });
  it('addresses a light lip by its entry in the light table', async () => {
    const result = await resolve(
      { ...identity, Mouth: 0x80, LipsToneFurPattern: 136 },
      recording().provider,
    );
    expect(result.slots.lip).toMatchObject({
      sheetIndex: 8,
      gridAddress: 'R2·C1',
    });
  });
  it.each([
    [{ Tribe: 'Raen' }, 'limbal'],
    [{ Tribe: 'Xaela' }, 'limbal'],
    [{ Tribe: 'Midlander' }, 'tattoo'],
    [{ Tribe: 'Veena' }, 'tattoo'],
    [{}, 'limbalOrTattoo'],
    [{ Race: 'Au Ra' }, 'limbal'],
  ])('calls the limbal slot of %j a %s', async (who, kind) => {
    const result = await resolve(
      { ...who, LimbalEyes: 3 },
      recording().provider,
    );
    expect(result.slots.limbal.kind).toBe(kind);
  });
  it('names every other slot by its own name', async () => {
    const result = await resolve(identity, recording().provider);
    for (const slot of [
      'leftEye',
      'rightEye',
      'hair',
      'highlights',
      'skin',
      'lip',
      'facePaint',
    ] as const)
      expect(result.slots[slot].kind).toBe(slot);
  });
  it.each([
    [{ LEyeColor: 3, REyeColor: 3 }, true],
    [{ LEyeColor: 3, REyeColor: 4 }, false],
    [{ LEyeColor: 3 }, false],
    [{ REyeColor: 3 }, false],
    [{ LEyeColor: 3, REyeColor: 'x' }, false],
    [{ LEyeColor: 3, REyeColor: null }, false],
    [{}, false],
    [{ LEyeColor: 0, REyeColor: 0 }, true],
  ])('reports eyesShareIndex for %j as %s', async (fields, shared) => {
    const result = await resolve(fields, recording().provider);
    expect(result.eyesShareIndex).toBe(shared);
  });
  it('carries the provider metadata, and null when it has none', async () => {
    const metadata = {
      schemaVersion: 1,
      datasetVersion: 'synthetic',
      gameVersion: null,
      source: { repository: 'r', commit: 'c', schemaVersion: 's' },
      artifactHashEncoding: 'hex',
      generatedFrom: null,
      sources: [],
      artifacts: [],
    };
    const { provider } = recording();
    expect(
      (await resolve({}, { ...provider, metadata })).paletteMetadata,
    ).toEqual(metadata);
    expect((await resolve({}, provider)).paletteMetadata).toBeNull();
  });
});

describe('the lip over the skin', () => {
  // A resolved skin color, so that the composite exists: the lip over it in linear light.
  const palette = (lip: string, skin: string): PaletteProvider => ({
    async getColor(request) {
      return color(request, request.palette === 'skin' ? skin : lip);
    },
  });
  const fields = (alpha: number) => ({
    Tribe: 'Raen',
    Gender: 'Feminine',
    Skintone: 4,
    Mouth: 0x80,
    LipsToneFurPattern: 6,
    MouthColor: `${gamma('#C04060')}, ${alpha}`,
    IsExtendedAppearanceValid: true,
  });
  const lipOver = async (alpha: number) =>
    (await resolve(fields(alpha), palette('#C04060', '#E0B090'))).slots.lip;
  it('composites with the stored alpha when it is between 0 and 1', async () => {
    const lip = await lipOver(0.6);
    expect(lip.lipComposite).toEqual({
      hex: '#CE7D76',
      alpha: 0.6,
      derived: true,
    });
    expect(lip.displayHex).toBe('#C04060');
  });
  it('clamps an alpha above 1 to 1, keeping the color and reporting the clip', async () => {
    const result = await resolve(fields(2), palette('#C04060', '#E0B090'));
    expect(result.slots.lip.lipComposite).toEqual({
      hex: '#C04060',
      alpha: 1,
      derived: true,
    });
    expect(result.slots.lip.alpha).toBe(2);
    expect(result.issues.map((issue) => issue.code)).toContain('ALPHA_CLAMPED');
  });
  it('shows no lip for an alpha of 0 or below, and no composite', async () => {
    for (const alpha of [0, -0.5]) {
      const lip = await lipOver(alpha);
      expect(lip).toMatchObject({
        interpretation: 'inactive',
        reason: 'noLip',
        lipComposite: null,
      });
    }
  });
  it('makes no composite when the validity flag does not make the opacity live', async () => {
    for (const flag of [false, null, undefined]) {
      const result = await resolve(
        { ...fields(0.6), IsExtendedAppearanceValid: flag },
        palette('#C04060', '#E0B090'),
      );
      expect(result.slots.lip, String(flag)).toMatchObject({
        extendedActive: false,
        displayHex: '#C04060',
        lipComposite: null,
      });
    }
  });
  it('makes no composite for a lip that could not be resolved, whatever its opacity', async () => {
    const result = await resolve(
      { ...fields(0.5), LipsToneFurPattern: 100 },
      palette('#C04060', '#E0B090'),
    );
    expect(result.slots.lip).toMatchObject({
      displayHex: null,
      lipComposite: null,
    });
  });
  it('composites a tiny positive alpha', async () => {
    expect((await lipOver(0.0001)).lipComposite).toMatchObject({
      alpha: 0.0001,
      derived: true,
    });
  });
  it('makes no composite without a skin color', async () => {
    const result = await resolve(
      { ...fields(0.6), Skintone: undefined },
      palette('#C04060', '#E0B090'),
    );
    expect(result.slots.lip.lipComposite).toBeNull();
  });
});
