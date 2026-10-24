import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_SLOTS,
  inspectChara,
  modelKey,
  readChara,
} from '../src/index.js';

const inspect = (fields: object) =>
  inspectChara(readChara(JSON.stringify(fields)));

describe('unsupported versus invalid labels', () => {
  // Every field that can be unsupported is a byte in the producers' files: a string, or an
  // integer 0-255, that is not a known value is unsupported; a wider integer cannot be a
  // producer value, so it is invalid. Both are warnings and the raw value is kept.
  it.each([
    ['Race', 255, 'unsupported'],
    ['Race', 256, 'invalid'],
    ['Race', 300, 'invalid'],
    ['Race', 65536, 'invalid'],
    ['Tribe', 200, 'unsupported'],
    ['Tribe', 300, 'invalid'],
    ['Gender', 2, 'unsupported'],
    ['Gender', 300, 'invalid'],
    ['Age', 5, 'unsupported'],
    ['Age', 256, 'invalid'],
    ['FacialFeatures', 300, 'invalid'],
    ['Race', 'FutureRace', 'unsupported'],
    ['Age', 'Elderly', 'unsupported'],
    ['FacialFeatures', 'Unknown', 'unsupported'],
    ['Race', 1.5, 'invalid'],
    ['Race', -1, 'invalid'],
  ] as const)('labels %s %j as %s', (key, value, state) => {
    const result = inspect({ [key]: value });
    const field =
      key === 'FacialFeatures'
        ? result.appearance.FacialFeatures
        : result.identity[
            key.toLowerCase() as 'race' | 'tribe' | 'gender' | 'age'
          ];
    expect(field).toMatchObject({ state, raw: value });
    expect(result.issues.map((issue) => issue.code)).toContain(
      state === 'unsupported' ? 'UNSUPPORTED_VALUE' : 'INVALID_FIELD',
    );
  });
});

describe('truncated diagnostics', () => {
  const crowded = (extra: object = {}) => ({
    Race: 'Hyur',
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`Unknown${i}`, i]),
    ),
    ...extra,
  });
  it('keeps the reader truncation marker as the single final entry', () => {
    const document = readChara(JSON.stringify(crowded({ HairTone: 'x' })), {
      maxIssues: 4,
    });
    expect(document.issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    const issues = inspectChara(document).issues;
    expect(issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    expect(
      issues.filter((issue) => issue.code === 'ISSUES_TRUNCATED'),
    ).toHaveLength(1);
    expect(issues.map((issue) => issue.code)).toContain('INVALID_FIELD');
  });
  it('keeps one final marker when inspection fills the list exactly to its cap', () => {
    // 63 copied reader diagnostics plus exactly one of the inspection's own make 64 entries without
    // overflowing, so only an explicit final marker can keep the reader's truncation visible.
    const fields: Record<string, unknown> = { Race: 'Hyur', HairTone: 'x' };
    for (let i = 0; i < 80; i++) fields[`Unknown${i}`] = i;
    const document = readChara(JSON.stringify(fields));
    expect(document.issues).toHaveLength(64);
    expect(document.issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    const issues = inspectChara(document).issues;
    expect(issues).toHaveLength(64);
    expect(issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    expect(
      issues.filter((issue) => issue.code === 'INVALID_FIELD'),
    ).toHaveLength(0); // replaced by the marker
    expect(
      issues.filter((issue) => issue.code === 'ISSUES_TRUNCATED'),
    ).toHaveLength(1);
  });
  it('keeps the marker last when the only inspection diagnostic is a bad ModelType', () => {
    const document = readChara(JSON.stringify(crowded({ ModelType: 'x' })), {
      maxIssues: 4,
    });
    const issues = inspectChara(document).issues;
    expect(issues.map((issue) => issue.code)).toContain('INVALID_FIELD');
    expect(issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    expect(
      issues.filter((issue) => issue.code === 'ISSUES_TRUNCATED'),
    ).toHaveLength(1);
  });
  it('does not invent a marker when the reader did not truncate', () => {
    const issues = inspectChara(
      readChara(JSON.stringify({ Race: 'Hyur', HairTone: 'x' })),
    ).issues;
    expect(issues.map((issue) => issue.code)).not.toContain('ISSUES_TRUNCATED');
  });
  it('still ends with exactly one marker when inspection overflows its own cap too', () => {
    const fields: Record<string, unknown> = { Race: 'Hyur' };
    for (let i = 0; i < 90; i++) fields[`Hair${i}`] = i;
    for (const key of [
      'HairTone',
      'Skintone',
      'Height',
      'Head',
      'Hair',
      'Eyebrows',
      'Eyes',
      'Nose',
      'Jaw',
      'Mouth',
    ])
      fields[key] = 'x';
    const issues = inspectChara(
      readChara(JSON.stringify(fields), { maxIssues: 3 }),
    ).issues;
    expect(issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    expect(
      issues.filter((issue) => issue.code === 'ISSUES_TRUNCATED'),
    ).toHaveLength(1);
    expect(issues.length).toBeLessThanOrEqual(64);
  });
});

describe('field evidence and identity', () => {
  it('distinguishes absent, null, zero, false, empty, invalid and unsupported', () => {
    const result = inspect({
      HairTone: 0,
      Height: null,
      EnableHighlights: false,
      Nickname: '',
      Skintone: { nested: 0 },
      Race: 'FutureRace',
    });
    expect(result.appearance.HairTone).toEqual({
      state: 'valid',
      raw: 0,
      value: 0,
    });
    expect(result.appearance.Highlights).toEqual({ state: 'absent' });
    expect(result.appearance.Height).toEqual({ state: 'null', raw: null });
    expect(result.appearance.EnableHighlights).toEqual({
      state: 'valid',
      raw: false,
      value: false,
    });
    expect(result.metadata.Nickname).toEqual({
      state: 'valid',
      raw: '',
      value: '',
    });
    expect(result.appearance.Skintone).toEqual({
      state: 'invalid',
      raw: { nested: 0 },
    });
    expect(result.identity.race).toEqual({
      state: 'unsupported',
      raw: 'FutureRace',
    });
  });

  it.each([
    [{ Race: 'Lalafel' }, 'Lalafell', 'race'],
    [{ Race: 'Lalafell' }, 'Lalafell', 'race'],
    [{ Tribe: 'Dunesfolk', Race: 'FutureRace' }, 'Lalafell', 'tribe'],
    [{ Tribe: 12, Race: 'Hyur' }, 'Au Ra', 'tribe'],
    [{ Tribe: 'FutureTribe', Race: 'Hyur' }, null, null],
    [{ Tribe: null, Race: 'Viera' }, 'Viera', 'race'],
  ])('normalizes race from evidence %j', (fields, race, source) => {
    const result = inspect(fields);
    expect(result.identity.canonicalRace).toBe(race);
    expect(result.identity.raceSource).toBe(source);
    if ('Race' in fields) expect(result.identity.race.raw).toBe(fields.Race);
  });

  it.each(['Helion', 'Helions', 13])(
    'normalizes the Helions tribe from %j without rewriting stored evidence',
    (tribe) => {
      const result = inspect({ Tribe: tribe });
      expect(result.identity.tribe).toEqual({
        state: 'valid',
        raw: tribe,
        value: 'Helions',
      });
      expect(result.identity.canonicalRace).toBe('Hrothgar');
      expect(result.identity.raceSource).toBe('tribe');
      expect(result.document.fields.Tribe).toBe(tribe);
      expect(result.issues).toEqual([]);
    },
  );

  it.each([
    [14, 'TheLost', 'Hrothgar'],
    [15, 'Rava', 'Viera'],
    [16, 'Veena', 'Viera'],
  ])('retains numeric tribe %s as %s', (id, tribe, race) => {
    const result = inspect({ Tribe: id });
    expect(result.identity.tribe).toEqual({
      state: 'valid',
      raw: id,
      value: tribe,
    });
    expect(result.identity.canonicalRace).toBe(race);
  });

  it.each(['helion', 'HELION', 'Helion '])(
    'keeps undocumented tribe spelling %j unsupported',
    (tribe) => {
      const result = inspect({ Tribe: tribe });
      expect(result.identity.tribe).toEqual({
        state: 'unsupported',
        raw: tribe,
      });
      expect(result.identity.canonicalRace).toBeNull();
    },
  );

  it('retains producer text without using it to select a parser', () => {
    const result = inspect({
      TypeName: '<script>hostile()</script>',
      Tribe: 'Xaela',
      Gender: 0,
    });
    expect(result.metadata.TypeName.value).toBe('<script>hostile()</script>');
    expect(result.identity.tribe.value).toBe('Xaela');
    expect(result.identity.gender.value).toBe('Masculine');
  });

  it('normalizes named facial flags while preserving declared labels', () => {
    const result = inspect({
      FacialFeatures: 'First, Third, LegacyTattoo',
      Age: 'Old',
    });
    expect(result.appearance.FacialFeatures.value).toBe(133);
    expect(result.appearance.FacialFeatures.raw).toBe(
      'First, Third, LegacyTattoo',
    );
    expect(result.identity.age.value).toBe('Old');
  });

  it.each([-1, 256, 1.5, '0', {}, []])(
    'reports invalid byte fields %j',
    (value) => {
      expect(inspect({ HairTone: value }).appearance.HairTone.state).toBe(
        'invalid',
      );
    },
  );
});

describe('equipment and facewear', () => {
  it('prevents consumer mutation of the public slot list from changing inspection and validation', () => {
    const slots = EQUIPMENT_SLOTS as unknown as string[];
    expect(() => {
      slots[0] = 'InjectedSlot';
    }).toThrow(TypeError);
    expect(Object.keys(inspect({ HairTone: 0 }).equipment)).toHaveLength(12);
    expect(() =>
      modelKey({ slot: 'InjectedSlot', base: 1, variant: 1 } as never),
    ).toThrow(expect.objectContaining({ code: 'INVALID_MODEL' }));
    expect(modelKey({ slot: 'MainHand', set: 634, base: 19, variant: 1 })).toBe(
      '4296213114',
    );
  });
  it('returns twelve slots and preserves worn/empty/missing/null/invalid states', () => {
    const result = inspect({
      HeadGear: { ModelBase: 361, ModelVariant: 5, DyeId: 0, DyeId2: 3 },
      Body: { ModelBase: 0, ModelVariant: 0 },
      Hands: null,
      Feet: 'bad',
      Legs: { ModelBase: 1 },
    });
    expect(Object.keys(result.equipment)).toHaveLength(12);
    expect(result.equipment.HeadGear.status).toBe('worn');
    expect(result.equipment.HeadGear.model).toEqual({
      slot: 'HeadGear',
      base: 361,
      variant: 5,
    });
    expect(result.equipment.HeadGear.dye1).toEqual({
      state: 'valid',
      raw: 0,
      value: 0,
    });
    expect(result.equipment.HeadGear.dye2.value).toBe(3);
    expect(result.equipment.Body.status).toBe('empty');
    expect(result.equipment.Hands.status).toBe('null');
    expect(result.equipment.Feet.status).toBe('invalid');
    expect(result.equipment.Legs.status).toBe('invalid');
    expect(result.equipment.Ears.status).toBe('absent');
    expect(result.equipment.Ears.dye1.state).toBe('absent');
  });

  it('keeps both rings separate and does not lose models to unrelated errors', () => {
    const result = inspect({
      Skintone: -1,
      LeftRing: { ModelBase: 1, ModelVariant: 2, DyeId: -1 },
      RightRing: { ModelBase: 1, ModelVariant: 2, DyeId: 0 },
      MainHand: { ModelSet: 634, ModelBase: 19, ModelVariant: 1 },
    });
    expect(result.equipment.LeftRing.model?.slot).toBe('LeftRing');
    expect(result.equipment.RightRing.model?.slot).toBe('RightRing');
    expect(result.equipment.LeftRing.dye1.state).toBe('invalid');
    expect(result.equipment.LeftRing.status).toBe('worn');
    expect(result.equipment.MainHand.model).toEqual({
      slot: 'MainHand',
      set: 634,
      base: 19,
      variant: 1,
    });
  });

  it.each([-1, 65536, 1.5, '361', null])(
    'refuses invalid model lanes %j',
    (value) => {
      const result = inspect({ Body: { ModelBase: value, ModelVariant: 1 } });
      expect(result.equipment.Body.status).toBe('invalid');
      expect(result.equipment.Body.model).toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining(
          value === null
            ? { code: 'INCOMPLETE_MODEL', path: ['Body'] }
            : { code: 'INVALID_FIELD', path: ['Body', 'ModelBase'] },
        ),
      );
    },
  );

  it.each([0, 65535, { GlassesId: 0 }, { GlassesId: 65535 }])(
    'accepts bounded legacy/current glasses %j',
    (value) => {
      const result = inspect({ Glasses: value });
      expect(result.facewear.state).toBe('valid');
      expect(result.facewear.value).toBe(
        typeof value === 'number' ? value : value.GlassesId,
      );
      expect(result.facewear.raw).toEqual(value);
    },
  );
  it.each([-1, 65536, {}, { GlassesId: '1' }, false])(
    'rejects invalid glasses %j',
    (value) => {
      expect(inspect({ Glasses: value }).facewear.state).toBe('invalid');
    },
  );
});

describe('extended appearance evidence', () => {
  it.each([
    ['0, 0.25, 1', [0, 0.25, 1]],
    [{ R: 0, G: 0.25, B: 1 }, [0, 0.25, 1]],
    [{ X: 0, Y: 0.25, Z: 1 }, [0, 0.25, 1]],
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
  ])('retains valid exact components %j', (raw, expected) => {
    const result = inspect({
      SkinColor: raw,
      IsExtendedAppearanceValid: false,
    });
    expect(result.extended.SkinColor).toEqual({
      state: 'valid',
      raw,
      value: expected,
    });
    expect(result.extended.IsExtendedAppearanceValid.value).toBe(false);
  });

  it('keeps eye channels and alpha zero without inferring activity', () => {
    const result = inspect({
      LeftEyeColor: '0, 0, 0',
      RightEyeColor: '1, 1, 1',
      MouthColor: '1, 0.5, 0.25, 0',
    });
    expect(result.extended.LeftEyeColor.value).toEqual([0, 0, 0]);
    expect(result.extended.RightEyeColor.value).toEqual([1, 1, 1]);
    expect(result.extended.MouthColor.value).toEqual([1, 0.5, 0.25, 0]);
    expect(result.extended.IsExtendedAppearanceValid.state).toBe('absent');
  });

  it.each([
    '',
    '0,,1',
    'NaN, 0, 1',
    '1e999,0,1',
    { X: 0, Y: 1 },
    { X: false, Y: 1, Z: 0 },
  ])('flags malformed color %j without coercion', (value) => {
    expect(inspect({ SkinColor: value }).extended.SkinColor.state).toBe(
      'invalid',
    );
  });

  it('leaves document unchanged and output JSON serializable', () => {
    const doc = readChara(
      '{"HairTone":0,"Future":{"n":null,"b":false},"Body":{"ModelBase":361,"ModelVariant":5}}',
    );
    const before = JSON.stringify(doc);
    const result = inspectChara(doc);
    expect(JSON.stringify(doc)).toBe(before);
    expect(JSON.parse(JSON.stringify(result)).equipment.Body.model).toEqual({
      slot: 'Body',
      base: 361,
      variant: 5,
    });
    expect(result.document).toBe(doc);
  });

  it.each([
    ['anamnesis/full', 'Hyur', 0],
    ['ktisis/full', 'Lalafell', 12],
    ['brio/extended', 'Au Ra', 4],
  ])('inspects reviewed fixture %s', (name, race, glasses) => {
    const text = readFileSync(
      new URL(`../../../fixtures/${name}.chara`, import.meta.url),
      'utf8',
    );
    const result = inspectChara(readChara(text));
    expect(result.identity.canonicalRace).toBe(race);
    expect(result.facewear.value).toBe(glasses);
  });
});
