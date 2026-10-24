import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveAppearance } from '../src/appearance/index.js';
import { inspectChara, readChara } from '../src/index.js';
import type { PaletteProvider, PaletteRequest } from '../src/palettes/index.js';
import { createDefaultPaletteProvider } from '../src/palettes/index.js';

const color = (hex: string) =>
  hex
    .slice(1)
    .match(/../g)
    ?.map((value) => (Number.parseInt(value, 16) / 255) ** 2)
    .join(', ') as string;
const provider: PaletteProvider = {
  async getColor(request) {
    const hex =
      request.palette === 'eyes'
        ? (['#FF0000', '#0000FF'][request.index] ?? '#808080')
        : request.palette === 'skin'
          ? '#000000'
          : request.palette === 'lipsLight'
            ? '#FFFFFF'
            : '#808080';
    return {
      ...request,
      hex,
      rgb: [0, 0, 0],
      datasetVersion: 'synthetic-test',
    };
  },
};
const resolve = (
  fields: object,
  palettes: PaletteProvider = provider,
  policy?: object,
) =>
  resolveAppearance(inspectChara(readChara(JSON.stringify(fields))), {
    palettes,
    ...(policy ? { policy } : {}),
  });

describe('appearance arbitration and evidence', () => {
  it('resolves legacy Helion skin and hair through the canonical Helions palettes', async () => {
    const inspection = inspectChara(
      readChara(
        JSON.stringify({
          Tribe: 'Helion',
          Gender: 'Feminine',
          Skintone: 0,
          HairTone: 0,
          LipsToneFurPattern: 1,
        }),
      ),
    );
    const result = await resolveAppearance(inspection, {
      palettes: createDefaultPaletteProvider(),
    });
    expect(result.slots.skin).toMatchObject({
      interpretation: 'palette',
      displayHex: '#7A5E40',
    });
    expect(result.slots.hair).toMatchObject({
      interpretation: 'palette',
      displayHex: '#FFFFFF',
    });
    expect(result.slots.lip).toMatchObject({
      interpretation: 'inactive',
      reason: 'furPattern',
      displayHex: null,
    });
    expect(inspection.identity.tribe.raw).toBe('Helion');
    expect(inspection.document.fields.Tribe).toBe('Helion');
  });

  it('compares extended color to shader while displaying the creator swatch', async () => {
    const result = await resolve(
      {
        Tribe: 'Raen',
        Gender: 'Feminine',
        HairTone: 42,
        HairColor: color('#E5D2AC'),
        IsExtendedAppearanceValid: true,
      },
      createDefaultPaletteProvider(),
    );
    expect(result.slots.hair).toMatchObject({
      creatorHex: '#FFDC98',
      shaderHex: '#E5D2AC',
      extendedHex: '#E5D2AC',
      displayHex: '#FFDC98',
      interpretation: 'palette',
      deltaE: 0,
    });
  });
  it.each([undefined, false, null])(
    'does not activate extended values with flag %s',
    async (flag) => {
      const result = await resolve({
        LEyeColor: 0,
        LeftEyeColor: color('#0000FF'),
        ...(flag === undefined ? {} : { IsExtendedAppearanceValid: flag }),
      });
      expect(result.slots.leftEye).toMatchObject({
        interpretation: 'palette',
        displayHex: '#FF0000',
        extendedHex: '#0000FF',
        extendedActive: false,
      });
      expect(result.slots.leftEye.reason).toBe('extendedInactive');
    },
  );
  it('selects a declared live off-grid color without changing stored evidence', async () => {
    const fields = {
      LEyeColor: 0,
      LeftEyeColor: color('#0000FF'),
      IsExtendedAppearanceValid: true,
    };
    const inspection = inspectChara(readChara(JSON.stringify(fields)));
    const before = JSON.stringify(inspection);
    const result = await resolveAppearance(inspection, { palettes: provider });
    expect(result.slots.leftEye).toMatchObject({
      interpretation: 'offGrid',
      creatorHex: '#FF0000',
      displayHex: '#0000FF',
      extendedHex: '#0000FF',
    });
    expect(JSON.stringify(inspection)).toBe(before);
    expect(result.slots.leftEye.storedExtended?.raw).toBe(fields.LeftEyeColor);
  });
  it('supports float-only colors and declared black rather than discarding zero', async () => {
    const result = await resolve({
      SkinColor: '0, 0, 0',
      IsExtendedAppearanceValid: true,
    });
    expect(result.slots.skin).toMatchObject({
      interpretation: 'extendedOnly',
      displayHex: '#000000',
      creatorHex: null,
    });
  });
  it('reports a complete all-zero legacy block as ambiguous without erasing it', async () => {
    const result = await resolve({
      LEyeColor: 0,
      SkinColor: '0,0,0',
      LeftEyeColor: '0,0,0',
      RightEyeColor: '0,0,0',
      LimbalRingColor: '0,0,0',
      HairColor: '0,0,0',
      HairHighlight: '0,0,0',
      MouthColor: '0,0,0,0',
      IsExtendedAppearanceValid: true,
    });
    expect(result.slots.leftEye).toMatchObject({
      interpretation: 'palette',
      extendedHex: '#000000',
      displayHex: '#FF0000',
      extendedActive: false,
      reason: 'ambiguousZeroBlock',
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'AMBIGUOUS_ZERO_BLOCK' }),
    );
  });
  it('reports clipping while preserving the original extended components', async () => {
    const result = await resolve({
      SkinColor: '-1, 2, 0',
      IsExtendedAppearanceValid: true,
    });
    expect(result.slots.skin).toMatchObject({
      displayHex: '#00FF00',
      storedExtended: { value: [-1, 2, 0] },
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'EXTENDED_CLAMPED' }),
    );
  });
  it('requires identity for race palettes but leaves unrelated shared colors usable', async () => {
    const result = await resolve({ Skintone: 0, HairTone: 0, LEyeColor: 0 });
    expect(result.slots.skin).toMatchObject({
      interpretation: 'unresolved',
      reason: 'missingTribeGender',
    });
    expect(result.slots.hair.displayHex).toBeNull();
    expect(result.slots.leftEye.displayHex).toBe('#FF0000');
  });
  it('does not infer producer behavior from a label or malformed field', async () => {
    const result = await resolve({
      TypeName: 'Brio Character File',
      LEyeColor: 0,
      LeftEyeColor: 'bad',
      REyeColor: 1,
    });
    expect(result.slots.leftEye).toMatchObject({
      interpretation: 'palette',
      extendedHex: null,
    });
    expect(result.corrections).toEqual([]);
  });
});

describe('activity and toned palettes', () => {
  it('retains disabled highlight/face-paint swatches without displaying an active color', async () => {
    const result = await resolve({
      EnableHighlights: false,
      Highlights: 0,
      HairHighlight: color('#FFFFFF'),
      IsExtendedAppearanceValid: true,
      FacePaint: 0,
      FacePaintColor: 128,
    });
    expect(result.slots.highlights).toMatchObject({
      active: false,
      interpretation: 'inactive',
      creatorHex: '#808080',
      displayHex: null,
    });
    expect(result.slots.facePaint).toMatchObject({
      active: false,
      interpretation: 'inactive',
      variant: 'light',
      creatorHex: '#808080',
      displayHex: null,
    });
  });
  it('keeps activity unknown when controls are absent', async () => {
    const result = await resolve({ Highlights: 0, FacePaintColor: 0 });
    expect(result.slots.highlights.active).toBeNull();
    expect(result.slots.facePaint.active).toBeNull();
  });
  it.each([
    [0, 0, 'dark'],
    [95, 95, 'dark'],
    [128, 0, 'light'],
    [223, 95, 'light'],
  ])(
    'maps lip index %s to sheet %s (%s)',
    async (index, sheetIndex, variant) => {
      const result = await resolve({ Race: 'Hyur', LipsToneFurPattern: index });
      expect(result.slots.lip).toMatchObject({
        interpretation: 'palette',
        sheetIndex,
        variant,
      });
    },
  );
  it.each([96, 127, 224, 255])(
    'does not clamp a toned palette gap/out-of-range index %s',
    async (index) => {
      const result = await resolve({
        Race: 'Hyur',
        LipsToneFurPattern: index,
        FacePaint: 200,
        FacePaintColor: index,
      });
      expect(result.slots.lip).toMatchObject({
        interpretation: 'unresolved',
        reason: 'indexOutOfRange',
        displayHex: null,
      });
      expect(result.slots.facePaint.displayHex).toBeNull();
    },
  );
  it('composites a lip whose enable bit is set', async () => {
    const result = await resolve({
      Tribe: 'Midlander',
      Gender: 'Masculine',
      Skintone: 0,
      LipsToneFurPattern: 128,
      Mouth: 130,
      MouthColor: `${color('#808080')}, 0.5`,
      IsExtendedAppearanceValid: true,
    });
    expect(result.slots.lip).toMatchObject({
      active: true,
      lipComposite: { hex: '#BCBCBC', alpha: 0.5, derived: true },
    });
  });
  it('compares a light lip to the dark shader entry and composites in linear light', async () => {
    const result = await resolve({
      Tribe: 'Midlander',
      Gender: 'Masculine',
      Skintone: 0,
      LipsToneFurPattern: 128,
      MouthColor: `${color('#808080')}, 0.5`,
      IsExtendedAppearanceValid: true,
    });
    expect(result.slots.lip).toMatchObject({
      creatorHex: '#FFFFFF',
      shaderHex: '#808080',
      extendedHex: '#808080',
      interpretation: 'palette',
      displayHex: '#FFFFFF',
      lipComposite: { hex: '#BCBCBC', alpha: 0.5, derived: true },
    });
  });
  it('applies zero alpha only to an active declared extended block', async () => {
    const inactive = await resolve({
      Race: 'Hyur',
      LipsToneFurPattern: 0,
      MouthColor: '1,1,1,0',
      IsExtendedAppearanceValid: false,
    });
    expect(inactive.slots.lip).toMatchObject({
      interpretation: 'palette',
      displayHex: '#808080',
      alpha: 0,
    });
    const active = await resolve({
      Race: 'Hyur',
      LipsToneFurPattern: 0,
      MouthColor: '1,1,1,0',
      IsExtendedAppearanceValid: true,
    });
    expect(active.slots.lip).toMatchObject({
      interpretation: 'inactive',
      reason: 'noLip',
      displayHex: null,
    });
  });
  it('does not invent opacity when alpha is absent', async () => {
    const result = await resolve({ Race: 'Hyur', LipsToneFurPattern: 0 });
    expect(result.slots.lip).toMatchObject({
      interpretation: 'palette',
      alpha: null,
      lipComposite: null,
    });
  });
  it.each([-0.5, 2])(
    'reports out-of-range opacity %s independently of composite availability',
    async (alpha) => {
      const result = await resolve({
        Race: 'Hyur',
        LipsToneFurPattern: 0,
        MouthColor: `1,1,1,${alpha}`,
        IsExtendedAppearanceValid: true,
      });
      expect(result.slots.lip.alpha).toBe(alpha);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'ALPHA_CLAMPED' }),
      );
      if (alpha < 0)
        expect(result.slots.lip).toMatchObject({
          interpretation: 'inactive',
          reason: 'noLip',
          displayHex: null,
        });
    },
  );
  it('treats Hrothgar fur indices separately and supports a live lip without an index', async () => {
    const inactive = await resolve({ Tribe: 'Helions', LipsToneFurPattern: 3 });
    expect(inactive.slots.lip).toMatchObject({
      interpretation: 'inactive',
      reason: 'furPattern',
      creatorHex: null,
    });
    const active = await resolve({
      Tribe: 'Helions',
      LipsToneFurPattern: 3,
      MouthColor: '1,0,0,1',
      IsExtendedAppearanceValid: true,
    });
    expect(active.slots.lip).toMatchObject({
      interpretation: 'extendedOnly',
      indexMeaning: 'furPattern',
      displayHex: '#FF0000',
    });
  });
  it('does not assume a possible fur index is a lip when race is unknown', async () => {
    expect((await resolve({ LipsToneFurPattern: 0 })).slots.lip).toMatchObject({
      interpretation: 'unresolved',
      reason: 'missingRace',
    });
  });
});

describe('face paint flip bit (FacePaint & 0x80)', () => {
  // Brio and Ktisis keep a mirror flag in bit 0x80 of FacePaint; the style is the low 7 bits.
  const paint = { Race: 'Hyur', FacePaintColor: 5 };
  it.each([
    [0, false],
    [128, false],
    [1, true],
    [127, true],
    [129, true],
    [200, true],
    [255, true],
  ])('treats FacePaint %s as paint present=%s', async (value, present) => {
    const result = await resolve({ ...paint, FacePaint: value });
    expect(result.slots.facePaint.active).toBe(present);
    if (present)
      expect(result.slots.facePaint).toMatchObject({
        interpretation: 'palette',
        reason: 'paletteOnly',
        displayHex: '#808080',
      });
    else
      expect(result.slots.facePaint).toMatchObject({
        interpretation: 'inactive',
        reason: 'facePaintNone',
        displayHex: null,
      });
  });
  it.each([
    ['null', { FacePaint: null }],
    ['out of range', { FacePaint: 300 }],
  ])(
    'keeps face paint activity unknown when FacePaint is %s',
    async (_name, extra) => {
      const result = await resolve({ ...paint, ...extra });
      expect(result.slots.facePaint).toMatchObject({
        active: null,
        interpretation: 'palette',
        reason: 'activityUnknown',
      });
    },
  );
});

describe('lip color enable bit (Mouth & 0x80)', () => {
  const hyurLip = { Race: 'Hyur', LipsToneFurPattern: 53 };
  it('marks the changed interpretation with policy version 1.1.0', async () => {
    expect((await resolve(hyurLip)).policy.version).toBe('1.1.0');
  });
  it.each([
    [0, false],
    [2, false],
    [127, false],
    [128, true],
    [130, true],
    [255, true],
  ])('treats Mouth %s as lip color enabled=%s', async (mouth, enabled) => {
    const result = await resolve({ ...hyurLip, Mouth: mouth });
    expect(result.slots.lip.active).toBe(enabled);
    if (enabled)
      expect(result.slots.lip).toMatchObject({
        interpretation: 'palette',
        reason: 'paletteOnly',
        displayHex: '#808080',
      });
    else
      expect(result.slots.lip).toMatchObject({
        interpretation: 'inactive',
        reason: 'lipDisabled',
        displayHex: null,
        extendedActive: false,
      });
  });
  it.each([
    ['absent', {}],
    ['null', { Mouth: null }],
    ['out of range', { Mouth: 300 }],
  ])('keeps lip activity unknown when Mouth is %s', async (_name, extra) => {
    const result = await resolve({ ...hyurLip, ...extra });
    expect(result.slots.lip).toMatchObject({
      active: null,
      interpretation: 'palette',
      reason: 'activityUnknown',
      displayHex: '#808080',
    });
  });
  it('lets a cleared bit win over a live non-zero opacity', async () => {
    const result = await resolve({
      ...hyurLip,
      Mouth: 2,
      MouthColor: '1,1,1,1',
      IsExtendedAppearanceValid: true,
    });
    expect(result.slots.lip).toMatchObject({
      interpretation: 'inactive',
      reason: 'lipDisabled',
      extendedActive: false,
      displayHex: null,
      lipComposite: null,
    });
  });
  it('still lets a live zero opacity disable a lip whose bit is set', async () => {
    const result = await resolve({
      ...hyurLip,
      Mouth: 130,
      MouthColor: '1,1,1,0',
      IsExtendedAppearanceValid: true,
    });
    expect(result.slots.lip).toMatchObject({
      interpretation: 'inactive',
      reason: 'noLip',
    });
  });
  it('does not apply the bit to a Hrothgar fur index', async () => {
    const stored = await resolve({
      Tribe: 'Helions',
      LipsToneFurPattern: 3,
      Mouth: 2,
    });
    expect(stored.slots.lip).toMatchObject({
      interpretation: 'inactive',
      reason: 'furPattern',
    });
    const live = await resolve({
      Tribe: 'Helions',
      LipsToneFurPattern: 3,
      Mouth: 2,
      MouthColor: '1,0,0,1',
      IsExtendedAppearanceValid: true,
    });
    expect(live.slots.lip).toMatchObject({
      interpretation: 'extendedOnly',
      displayHex: '#FF0000',
    });
  });
  it('does not turn an unknown race into an inactive lip', async () => {
    const result = await resolve({ LipsToneFurPattern: 53, Mouth: 2 });
    expect(result.slots.lip).toMatchObject({
      interpretation: 'unresolved',
      reason: 'missingRace',
    });
  });
  // A Hrothgar ignores the bit and any other race obeys it, so with no race the
  // lip is only known to be on when the bit is set.
  it.each([
    [undefined, null],
    [2, null],
    [130, true],
  ])(
    'reports lip activity for Mouth %s as %s when the race is unknown',
    async (mouth, active) => {
      const result = await resolve({
        MouthColor: '1,0,0,1',
        IsExtendedAppearanceValid: true,
        ...(mouth === undefined ? {} : { Mouth: mouth }),
      });
      expect(result.slots.lip.active).toBe(active);
      expect(result.slots.lip).toMatchObject({
        interpretation: 'extendedOnly',
        displayHex: '#FF0000',
      });
    },
  );
});

describe('historical eye pairing and thresholds', () => {
  it('corrects only a fully crossed live pair and records both original colors', async () => {
    const result = await resolve({
      LEyeColor: 0,
      REyeColor: 1,
      LeftEyeColor: color('#0000FF'),
      RightEyeColor: color('#FF0000'),
      IsExtendedAppearanceValid: true,
    });
    expect(result.corrections).toEqual([
      { code: 'HISTORICAL_EYE_PAIR_SWAP', slots: ['leftEye', 'rightEye'] },
    ]);
    expect(result.slots.leftEye).toMatchObject({
      extendedHex: '#0000FF',
      effectiveExtendedHex: '#FF0000',
      interpretation: 'palette',
      correction: 'historicalEyePairSwap',
    });
    expect(result.slots.rightEye.effectiveExtendedHex).toBe('#0000FF');
  });
  it.each([
    {
      LEyeColor: 0,
      REyeColor: 1,
      LeftEyeColor: color('#FF0000'),
      RightEyeColor: color('#0000FF'),
      IsExtendedAppearanceValid: true,
    },
    {
      LEyeColor: 0,
      REyeColor: 1,
      LeftEyeColor: color('#0000FF'),
      RightEyeColor: color('#00FF00'),
      IsExtendedAppearanceValid: true,
    },
    {
      LEyeColor: 0,
      REyeColor: 0,
      LeftEyeColor: color('#0000FF'),
      RightEyeColor: color('#FF0000'),
      IsExtendedAppearanceValid: true,
    },
    {
      LEyeColor: 0,
      REyeColor: 1,
      LeftEyeColor: color('#0000FF'),
      RightEyeColor: color('#FF0000'),
    },
  ])(
    'does not swap unrelated, partial, equal-index, or inactive pairs',
    async (fields) => {
      expect((await resolve(fields)).corrections).toEqual([]);
    },
  );
  it('allows disabling the historical correction', async () => {
    const result = await resolve(
      {
        LEyeColor: 0,
        REyeColor: 1,
        LeftEyeColor: color('#0000FF'),
        RightEyeColor: color('#FF0000'),
        IsExtendedAppearanceValid: true,
      },
      provider,
      { historicalEyeCorrection: false },
    );
    expect(result.corrections).toEqual([]);
    expect(result.slots.leftEye.interpretation).toBe('offGrid');
  });
  describe('uncorrected crossing evidence', () => {
    // Brio 0.7.2+ stores each eye's extended color under the other eye's name. A custom
    // color on one eye hides the second match, so only a one-sided crossed match remains.
    const live = {
      LEyeColor: 0,
      REyeColor: 1,
      IsExtendedAppearanceValid: true,
    };
    const unconfirmed = (result: Awaited<ReturnType<typeof resolve>>) =>
      result.issues.filter((issue) => issue.code === 'EYE_PAIRING_UNCONFIRMED');
    it.each([
      ['left matches the right shader', '#0000FF', '#00FF00'],
      ['right matches the left shader', '#00FF00', '#FF0000'],
    ])(
      'flags a one-sided crossed match when %s, without swapping',
      async (_name, leftHex, rightHex) => {
        const result = await resolve({
          ...live,
          LeftEyeColor: color(leftHex as string),
          RightEyeColor: color(rightHex as string),
        });
        expect(result.corrections).toEqual([]);
        expect(unconfirmed(result)).toEqual([
          {
            code: 'EYE_PAIRING_UNCONFIRMED',
            severity: 'warning',
            path: [],
            message: expect.any(String),
          },
        ]);
        expect(result.slots.leftEye.effectiveExtendedHex).toBe(
          result.slots.leftEye.extendedHex,
        );
        expect(result.slots.rightEye.effectiveExtendedHex).toBe(
          result.slots.rightEye.extendedHex,
        );
      },
    );
    it.each([
      ['straight on-grid pair', '#FF0000', '#0000FF', {}],
      ['fully crossed pair that is corrected', '#0000FF', '#FF0000', {}],
      ['two custom colors', '#00FF00', '#FFFF00', {}],
      ['equal indices', '#0000FF', '#00FF00', { REyeColor: 0 }],
      [
        'one crossed eye beside an eye on its own shader',
        '#0000FF',
        '#0000FF',
        {},
      ],
      [
        'an inactive extended block',
        '#0000FF',
        '#00FF00',
        { IsExtendedAppearanceValid: false },
      ],
    ])('stays quiet for %s', async (_name, leftHex, rightHex, extra) => {
      const result = await resolve({
        ...live,
        LeftEyeColor: color(leftHex as string),
        RightEyeColor: color(rightHex as string),
        ...(extra as object),
      });
      expect(unconfirmed(result)).toEqual([]);
    });
    it('reports a fully crossed pair that policy left uncorrected', async () => {
      const result = await resolve(
        {
          ...live,
          LeftEyeColor: color('#0000FF'),
          RightEyeColor: color('#FF0000'),
        },
        provider,
        { historicalEyeCorrection: false },
      );
      expect(result.corrections).toEqual([]);
      expect(unconfirmed(result)).toHaveLength(1);
      expect(unconfirmed(result)[0]?.message).toContain(
        'correction is disabled',
      );
    });
  });
  // Neutral-axis CIEDE2000 distances from #808080: #909090 < 6; #919191 = 6.06269.
  it.each([
    ['#909090', 'palette'],
    ['#919191', 'offGrid'],
  ])(
    'tests both sides of the default 6 DeltaE cutoff for %s',
    async (hex, interpretation) => {
      const result = await resolve({
        Highlights: 0,
        EnableHighlights: true,
        HairHighlight: color(hex),
        IsExtendedAppearanceValid: true,
      });
      expect(result.slots.highlights.interpretation).toBe(interpretation);
    },
  );
  // Neutral-axis distances from #808080: #828282 = 0.75298; #838383 = 1.12538.
  it.each([
    ['#828282', 1],
    ['#838383', 0],
  ])(
    'tests both sides of the historical eye tolerance with %s',
    async (crossedHex, corrections) => {
      const neutral: PaletteProvider = {
        async getColor(request) {
          return {
            ...request,
            hex: request.index === 0 ? '#808080' : '#FFFFFF',
            rgb: [0, 0, 0],
            datasetVersion: 'test',
          };
        },
      };
      const result = await resolve(
        {
          LEyeColor: 0,
          REyeColor: 1,
          LeftEyeColor: color('#FFFFFF'),
          RightEyeColor: color(crossedHex as string),
          IsExtendedAppearanceValid: true,
        },
        neutral,
      );
      expect(result.corrections).toHaveLength(corrections as number);
    },
  );
  it.each([NaN, Infinity, -1, '6', null])(
    'rejects invalid policy options %s before provider work',
    async (threshold) => {
      await expect(
        resolve({ LEyeColor: 0 }, provider, { offGridDeltaE: threshold }),
      ).rejects.toMatchObject({ code: 'INVALID_APPEARANCE_OPTIONS' });
    },
  );
});

describe('provider failures and independent expectations', () => {
  it('returns fixed issues on provider failure and preserves other local evidence', async () => {
    const failed: PaletteProvider = {
      async getColor() {
        throw new Error('PRIVATE_UPSTREAM_CANARY');
      },
    };
    const result = await resolve(
      { LEyeColor: 0, LeftEyeColor: '0,0,0' },
      failed,
    );
    expect(result.slots.leftEye).toMatchObject({
      interpretation: 'unresolved',
      extendedHex: '#000000',
    });
    expect(JSON.stringify(result.issues)).not.toContain(
      'PRIVATE_UPSTREAM_CANARY',
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'PALETTE_UNAVAILABLE' }),
    );
  });
  // Mismatched associations are covered in appearance-guards.test.ts.
  it('rejects a provider color that is not a canonical hex', async () => {
    const hostile = {
      async getColor(request: PaletteRequest) {
        return {
          ...request,
          hex: 'url(https://example.invalid)',
          rgb: [0, 0, 0],
          datasetVersion: 'test',
        };
      },
    } as PaletteProvider;
    const result = await resolve({ LEyeColor: 0 }, hostile);
    expect(result.slots.leftEye.displayHex).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_PALETTE_RESPONSE' }),
    );
  });
  it('does not silently replace a missing shader reference with a creator comparison', async () => {
    const noShader: PaletteProvider = {
      async getColor(request) {
        return request.table === 'shader' ? null : provider.getColor(request);
      },
    };
    const result = await resolve(
      {
        LEyeColor: 0,
        LeftEyeColor: color('#FF0000'),
        IsExtendedAppearanceValid: true,
      },
      noShader,
    );
    expect(result.slots.leftEye).toMatchObject({
      interpretation: 'unresolved',
      reason: 'missingShaderReference',
      creatorHex: '#FF0000',
      shaderHex: null,
      deltaE: null,
    });
  });
  it('matches reviewed bundled-data expectations', async () => {
    const cases = JSON.parse(
      readFileSync(
        new URL('../../../fixtures/expected/appearance.json', import.meta.url),
        'utf8',
      ),
    ) as { input: object; slot: string; expected: object }[];
    for (const entry of cases) {
      const result = await resolve(entry.input, createDefaultPaletteProvider());
      expect(
        result.slots[entry.slot as keyof typeof result.slots],
      ).toMatchObject(entry.expected);
    }
  });
});
