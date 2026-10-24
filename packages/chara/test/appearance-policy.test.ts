import { describe, expect, it, vi } from 'vitest';
import { hexDeltaE } from '../src/appearance/color-math.js';
import {
  AppearanceInputError,
  DEFAULT_APPEARANCE_POLICY,
  resolveAppearance,
} from '../src/appearance/index.js';
import { inspectChara, readChara } from '../src/index.js';
import type { PaletteProvider } from '../src/palettes/index.js';

// The policy is checked before any provider work, every bound is pinned from both sides, and the
// thresholds do what they say at exactly their value.

const gamma = (hex: string) =>
  hex
    .slice(1)
    .match(/../g)
    ?.map((value) => (Number.parseInt(value, 16) / 255) ** 2)
    .join(', ') as string;
const inspect = (fields: object) =>
  inspectChara(readChara(JSON.stringify({ Hair: 0, ...fields })));
// Colors are keyed by palette and index; `creator`, when given, is what the creator table answers
// instead, so that a comparison that reads the wrong table gives a different result.
const spy = (colors: Record<string, string> = {}, creator?: string) => {
  const getColor = vi.fn<PaletteProvider['getColor']>(async (request) => ({
    ...request,
    hex:
      request.table === 'creator' && creator
        ? creator
        : (colors[`${request.palette}:${request.index}`] ?? '#808080'),
    rgb: [0, 0, 0],
    datasetVersion: 'synthetic-test',
  }));
  return { getColor } satisfies PaletteProvider;
};
// Enough stored colors that a provider would be asked something if validation came late.
const busy = {
  LEyeColor: 0,
  REyeColor: 1,
  HairTone: 2,
  Skintone: 3,
  Tribe: 'Midlander',
  Gender: 'Masculine',
};

describe('policy validation', () => {
  const NOT_NUMBERS = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    -0.0001,
    100.0001,
    '6',
    null,
    undefined,
    true,
    [],
    {},
  ];
  const invalid: [string, unknown][] = [
    ['a null policy', null],
    ['an array', []],
    ['a string', '6'],
    ['a number', 6],
    ['true', true],
    ...NOT_NUMBERS.map((value): [string, unknown] => [
      `offGridDeltaE ${JSON.stringify(value) ?? 'undefined'}`,
      { offGridDeltaE: value },
    ]),
    ...NOT_NUMBERS.map((value): [string, unknown] => [
      `eyeMatchDeltaE ${JSON.stringify(value) ?? 'undefined'}`,
      { eyeMatchDeltaE: value },
    ]),
    ...['true', 1, 0, null, undefined, {}].map((value): [string, unknown] => [
      `historicalEyeCorrection ${JSON.stringify(value) ?? 'undefined'}`,
      { historicalEyeCorrection: value },
    ]),
    ['an eye match above the default grid threshold', { eyeMatchDeltaE: 7 }],
    ['a grid threshold under the default eye match', { offGridDeltaE: 0 }],
    ['a grid threshold just under the eye match', { offGridDeltaE: 0.5 }],
    [
      'an eye match just above the grid threshold',
      { offGridDeltaE: 5, eyeMatchDeltaE: 5.0001 },
    ],
  ];
  it.each(invalid)(
    'refuses %s before asking the provider anything',
    async (_name, policy) => {
      const palettes = spy();
      const error = await resolveAppearance(inspect(busy), {
        palettes,
        policy: policy as never,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppearanceInputError);
      expect(error).toMatchObject({
        name: 'AppearanceInputError',
        code: 'INVALID_APPEARANCE_OPTIONS',
        message: 'Appearance options are invalid.',
      });
      expect(palettes.getColor).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['no options', undefined],
    ['null options', null],
    ['a string', 'x'],
    ['a number', 42],
    ['no provider', {}],
    ['a null provider', { palettes: null }],
    ['a provider without getColor', { palettes: {} }],
    ['a getColor that is not a function', { palettes: { getColor: 'nope' } }],
  ])('refuses %s', async (_name, options) => {
    await expect(
      resolveAppearance(inspect(busy), options as never),
    ).rejects.toMatchObject({ code: 'INVALID_APPEARANCE_OPTIONS' });
  });
  it.each([
    ['no policy', undefined, DEFAULT_APPEARANCE_POLICY],
    ['an empty policy', {}, DEFAULT_APPEARANCE_POLICY],
    [
      'zero for both thresholds',
      { offGridDeltaE: 0, eyeMatchDeltaE: 0 },
      { ...DEFAULT_APPEARANCE_POLICY, offGridDeltaE: 0, eyeMatchDeltaE: 0 },
    ],
    [
      'both thresholds at 100',
      { offGridDeltaE: 100, eyeMatchDeltaE: 100 },
      { ...DEFAULT_APPEARANCE_POLICY, offGridDeltaE: 100, eyeMatchDeltaE: 100 },
    ],
    [
      'an eye match equal to the default grid threshold',
      { eyeMatchDeltaE: 6 },
      { ...DEFAULT_APPEARANCE_POLICY, eyeMatchDeltaE: 6 },
    ],
    [
      'the correction turned off',
      { historicalEyeCorrection: false },
      { ...DEFAULT_APPEARANCE_POLICY, historicalEyeCorrection: false },
    ],
    [
      'fractions',
      { offGridDeltaE: 2.5, eyeMatchDeltaE: 0.25 },
      {
        ...DEFAULT_APPEARANCE_POLICY,
        offGridDeltaE: 2.5,
        eyeMatchDeltaE: 0.25,
      },
    ],
  ])(
    'accepts %s and reports the policy it used',
    async (_name, policy, expected) => {
      const result = await resolveAppearance(inspect(busy), {
        palettes: spy(),
        ...(policy === undefined ? {} : { policy }),
      });
      expect(result.policy).toEqual(expected);
      expect(Object.isFrozen(result.policy)).toBe(true);
    },
  );
  it('has the documented defaults', () => {
    expect({ ...DEFAULT_APPEARANCE_POLICY }).toEqual({
      version: '1.1.0',
      offGridDeltaE: 6,
      eyeMatchDeltaE: 1,
      historicalEyeCorrection: true,
    });
    expect(Object.isFrozen(DEFAULT_APPEARANCE_POLICY)).toBe(true);
  });
  it('ignores a threshold that is only inherited', async () => {
    const policy = Object.create({
      offGridDeltaE: 100,
      eyeMatchDeltaE: 50,
      historicalEyeCorrection: false,
    });
    const result = await resolveAppearance(inspect(busy), {
      palettes: spy(),
      policy,
    });
    expect(result.policy).toEqual(DEFAULT_APPEARANCE_POLICY);
  });
  it('is not changed by the caller afterwards', async () => {
    const policy = { offGridDeltaE: 4, eyeMatchDeltaE: 2 };
    const result = await resolveAppearance(inspect(busy), {
      palettes: spy(),
      policy,
    });
    policy.offGridDeltaE = 90;
    expect(result.policy.offGridDeltaE).toBe(4);
  });
});

describe('the grid threshold at exactly its value', () => {
  // Hair 0 for a Midlander: the provider's shader color is gray; the stored extended color is a
  // little lighter, a known distance away.
  const extended = '#8A8A8A';
  const fields = {
    Tribe: 'Midlander',
    Gender: 'Masculine',
    HairTone: 0,
    HairColor: gamma(extended),
    IsExtendedAppearanceValid: true,
  };
  const distance = hexDeltaE('#808080', extended);
  const hair = async (policy?: object) =>
    (
      await resolveAppearance(inspect(fields), {
        palettes: spy({ 'hair:0': '#808080' }),
        ...(policy ? { policy } : {}),
      })
    ).slots.hair;
  it('has a distance above the default eye match and below the default threshold', () => {
    expect(distance).toBeGreaterThan(1);
    expect(distance).toBeLessThan(6);
  });
  it('keeps the grid color when the distance equals the threshold, and leaves it when it is exceeded', async () => {
    expect(await hair({ offGridDeltaE: distance })).toMatchObject({
      interpretation: 'palette',
      deltaE: distance,
      reason: 'paletteAgreement',
    });
    expect(await hair({ offGridDeltaE: distance * (1 - 1e-9) })).toMatchObject({
      interpretation: 'offGrid',
      displayHex: extended,
      reason: 'offGrid',
    });
  });
  it('uses the default threshold of 6 when none is given', async () => {
    expect((await hair()).interpretation).toBe('palette');
    expect((await hair({ offGridDeltaE: 2 })).interpretation).toBe('offGrid');
    expect((await hair({ offGridDeltaE: 100 })).interpretation).toBe('palette');
  });
  it('treats a zero threshold as exact equality only', async () => {
    const same = await resolveAppearance(
      inspect({ ...fields, HairColor: gamma('#808080') }),
      {
        palettes: spy({ 'hair:0': '#808080' }),
        policy: { offGridDeltaE: 0, eyeMatchDeltaE: 0 },
      },
    );
    expect(same.slots.hair).toMatchObject({
      interpretation: 'palette',
      deltaE: 0,
    });
    const near = await resolveAppearance(inspect(fields), {
      palettes: spy({ 'hair:0': '#808080' }),
      policy: { offGridDeltaE: 0, eyeMatchDeltaE: 0 },
    });
    expect(near.slots.hair.interpretation).toBe('offGrid');
  });
});

describe('the eye-pair rule needs each extended color to miss its own shader', () => {
  // Two different eyes whose shader colors are only 1.2 apart, each extended color exactly on its own
  // shader: each sits within the (raised) eye match of the other eye's shader as well, but it also
  // matches its own, so the pair is not crossed and nothing may be corrected.
  const near = { 'eyes:9': '#FAF7DF', 'eyes:16': '#FAF6E1' };
  const fields = {
    LEyeColor: 9,
    REyeColor: 16,
    LeftEyeColor: gamma(near['eyes:9']),
    RightEyeColor: gamma(near['eyes:16']),
    IsExtendedAppearanceValid: true,
  };
  it('has shader colors that are close but not equal', () => {
    const apart = hexDeltaE(near['eyes:9'], near['eyes:16']);
    expect(apart).toBeGreaterThan(1);
    expect(apart).toBeLessThan(1.5);
  });
  it('makes no correction and raises no warning when each color is on its own shader', async () => {
    const result = await resolveAppearance(inspect(fields), {
      palettes: spy(near),
      policy: { eyeMatchDeltaE: 1.5 },
    });
    expect(result.corrections).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([]);
    expect(result.slots.leftEye.correction).toBeNull();
    expect(result.slots.rightEye.correction).toBeNull();
  });
});

describe('the eye-pair rule needs both extended colors to miss their own shader', () => {
  // The same close shader colors (1.2 apart). One eye's color sits exactly on its own shader and the
  // other eye's color lands on the far side of the first one, so the second eye looks crossed on its
  // own and the first does not: a single crossed eye is no pair, and nothing may be corrected.
  const L = '#FAF7DF';
  const R = '#FAF6E1';
  const beyondR = '#FAF5E3';
  const beyondL = '#FAF8DD';
  const run = (left: string, right: string) =>
    resolveAppearance(
      inspect({
        LEyeColor: 9,
        REyeColor: 16,
        LeftEyeColor: gamma(left),
        RightEyeColor: gamma(right),
        IsExtendedAppearanceValid: true,
      }),
      {
        palettes: spy({ 'eyes:9': L, 'eyes:16': R }),
        policy: { eyeMatchDeltaE: 1.5 },
      },
    );
  it('has colors at the distances the cases rely on', () => {
    expect(hexDeltaE(L, R)).toBeLessThan(1.5);
    for (const [color, near, far] of [
      [beyondR, R, L],
      [beyondL, L, R],
    ] as const) {
      expect(hexDeltaE(color, near)).toBeLessThanOrEqual(1.5);
      expect(hexDeltaE(color, far)).toBeGreaterThan(1.5);
    }
  });
  it.each([
    ['the right eye is on its own shader', beyondR, R],
    ['the left eye is on its own shader', L, beyondL],
  ])('makes no correction when %s', async (_name, left, right) => {
    const result = await run(left, right);
    expect(result.corrections).toEqual([]);
    expect(result.slots.leftEye.correction).toBeNull();
    expect(result.slots.rightEye.correction).toBeNull();
  });
  it('corrects when both colors are crossed (the control)', async () => {
    const result = await run(beyondR, beyondL);
    expect(result.corrections).toHaveLength(1);
  });
});

describe('the eye match threshold at exactly its value', () => {
  // Each eye's extended color sits next to the other eye's shader color.
  const leftNearRight = '#0000FE';
  const rightNearLeft = '#FE0000';
  const near = Math.max(
    hexDeltaE(leftNearRight, '#0000FF'),
    hexDeltaE(rightNearLeft, '#FF0000'),
  );
  const colors = { 'eyes:0': '#FF0000', 'eyes:1': '#0000FF' };
  const fields = {
    LEyeColor: 0,
    REyeColor: 1,
    LeftEyeColor: gamma(leftNearRight),
    RightEyeColor: gamma(rightNearLeft),
    IsExtendedAppearanceValid: true,
  };
  // The creator table answers a far color, so only the shader table can match the other eye.
  const run = (policy?: object) =>
    resolveAppearance(inspect(fields), {
      palettes: spy(colors, '#00FF00'),
      ...(policy ? { policy } : {}),
    });
  it('is small but not zero', () => {
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(1);
  });
  it('corrects a crossed pair whose distance equals the threshold, and not one just under it', async () => {
    expect((await run({ eyeMatchDeltaE: near })).corrections).toEqual([
      { code: 'HISTORICAL_EYE_PAIR_SWAP', slots: ['leftEye', 'rightEye'] },
    ]);
    expect(
      (await run({ eyeMatchDeltaE: near * (1 - 1e-9) })).corrections,
    ).toEqual([]);
  });
  it('corrects at the default threshold of 1, and does not once the threshold is zero', async () => {
    expect((await run()).corrections).toHaveLength(1);
    expect((await run({ eyeMatchDeltaE: 0 })).corrections).toEqual([]);
  });
});
