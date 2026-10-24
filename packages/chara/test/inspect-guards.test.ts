import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { inspectChara, readChara } from '../src/index.js';

// Inspection decisions that have a rule of their own: the weapon worn/empty test, the numeric and
// alias forms of the enumerations, the strings the vector and flag parsers take, and the typing of
// the metadata fields. Each case fails if its rule is changed.

const inspect = (fields: Record<string, unknown>) =>
  inspectChara(readChara(JSON.stringify({ Hair: 0, ...fields })));
const codes = (fields: Record<string, unknown>) =>
  inspect(fields).issues.map((issue) => [issue.code, issue.path.join('.')]);

describe('the weapon worn or empty rule', () => {
  const lanes = (set: unknown, base: unknown, variant: unknown = 0) => ({
    ModelSet: set,
    ModelBase: base,
    ModelVariant: variant,
  });
  for (const slot of ['MainHand', 'OffHand'] as const) {
    it(`${slot}: all lanes zero is empty, and a set, a base or both is worn`, () => {
      const empty = inspect({ [slot]: lanes(0, 0) }).equipment[slot];
      expect(empty.status).toBe('empty');
      expect(empty.model).toEqual({ slot, set: 0, base: 0, variant: 0 });
      for (const [set, base] of [
        [5, 0],
        [0, 7],
        [5, 7],
        [65535, 0],
      ] as const) {
        const worn = inspect({ [slot]: lanes(set, base, 1) }).equipment[slot];
        expect(worn.status, `set ${set} base ${base}`).toBe('worn');
        expect(worn.model).toEqual({ slot, set, base, variant: 1 });
      }
    });
    it(`${slot}: a variant alone does not make it worn`, () => {
      expect(inspect({ [slot]: lanes(0, 0, 9) }).equipment[slot].status).toBe(
        'empty',
      );
    });
    it(`${slot}: a missing, null or invalid ModelSet is an incomplete model`, () => {
      for (const set of [undefined, null, '5', -1, 65536, 1.5, true]) {
        const stored = { ModelBase: 5, ModelVariant: 1, DyeId: 3 } as Record<
          string,
          unknown
        >;
        if (set !== undefined) stored.ModelSet = set;
        const result = inspect({ [slot]: stored });
        expect(result.equipment[slot].status, String(set)).toBe('invalid');
        expect(result.equipment[slot].model).toBeNull();
        expect(
          result.issues.filter((issue) => issue.code === 'INCOMPLETE_MODEL'),
        ).toEqual([
          expect.objectContaining({ code: 'INCOMPLETE_MODEL', path: [slot] }),
        ]);
      }
    });
  }
  it('does not read ModelSet for any other slot', () => {
    const body = inspect({
      Body: { ModelSet: 9, ModelBase: 0, ModelVariant: 0 },
    }).equipment.Body;
    expect(body.status).toBe('empty');
    expect(body.model).toEqual({ slot: 'Body', base: 0, variant: 0 });
    expect(body.set).toEqual({ state: 'absent' });
    expect(
      inspect({ Body: { ModelSet: 9, ModelBase: 361, ModelVariant: 5 } })
        .equipment.Body.model,
    ).toEqual({ slot: 'Body', base: 361, variant: 5 });
  });
  it('treats a non-weapon the same way by base alone, and refuses an incomplete one', () => {
    expect(
      inspect({ Body: { ModelBase: 1, ModelVariant: 0 } }).equipment.Body
        .status,
    ).toBe('worn');
    expect(
      inspect({ Body: { ModelBase: 0, ModelVariant: 0 } }).equipment.Body
        .status,
    ).toBe('empty');
    const missing = inspect({ Body: { ModelVariant: 0 } });
    expect(missing.equipment.Body.status).toBe('invalid');
    expect(missing.issues.map((issue) => issue.code)).toContain(
      'INCOMPLETE_MODEL',
    );
  });
  it('needs both lanes of a model, in every slot', () => {
    for (const slot of ['Body', 'MainHand'] as const) {
      const set = slot === 'MainHand' ? { ModelSet: 1 } : {};
      for (const stored of [
        { ...set, ModelBase: 5 },
        { ...set, ModelVariant: 5 },
        { ...set, ModelBase: 5, ModelVariant: 65536 },
        { ...set, ModelBase: 65536, ModelVariant: 5 },
        { ...set, ModelBase: 5, ModelVariant: null },
      ]) {
        const result = inspect({ [slot]: stored });
        expect(result.equipment[slot].status, JSON.stringify(stored)).toBe(
          'invalid',
        );
        expect(result.equipment[slot].model).toBeNull();
        expect(result.issues.map((issue) => issue.code)).toContain(
          'INCOMPLETE_MODEL',
        );
      }
    }
  });
  it('reports absent, null and non-object slots by their stored state', () => {
    const result = inspect({ HeadGear: null, Body: 'x' });
    expect(result.equipment.HeadGear.status).toBe('null');
    expect(result.equipment.HeadGear.stored).toEqual({
      state: 'null',
      raw: null,
    });
    expect(result.equipment.Body.status).toBe('invalid');
    expect(result.equipment.Legs.status).toBe('absent');
    expect(result.equipment.Legs.stored).toEqual({ state: 'absent' });
  });
  it.each([['x'], [[]], [5], [true], [['a']]])(
    'calls a slot holding %j invalid (not unsupported), with INVALID_FIELD on the slot',
    (stored) => {
      const result = inspect({ Body: stored });
      expect(result.equipment.Body.stored).toEqual({
        state: 'invalid',
        raw: stored,
      });
      expect(result.equipment.Body.status).toBe('invalid');
      expect(result.equipment.Body.model).toBeNull();
      expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
        ['INVALID_FIELD', ['Body']],
      ]);
    },
  );
});

describe('the weapons of the producer exports', () => {
  it.each([
    'brio-default.chara',
    'anamnesis-default.chara',
    'anamnesis-default-metadata.chara',
    'ktisis-default.chara',
  ])('are worn in %s', async (name) => {
    const bytes = await readFile(
      new URL(`../../../fixtures/producer-exports/${name}`, import.meta.url),
    );
    const { equipment } = inspectChara(readChara(bytes));
    expect(equipment.MainHand.status).toBe('worn');
    expect(equipment.MainHand.model).toEqual({
      slot: 'MainHand',
      set: 2027,
      base: 4,
      variant: 1,
    });
    expect(equipment.OffHand.status).toBe('worn');
    expect(equipment.OffHand.model).toEqual({
      slot: 'OffHand',
      set: 2099,
      base: 1,
      variant: 1,
    });
  });
});

describe('Race, Tribe and the codes of their issues', () => {
  it('reports a declared race that differs from the tribe with RACE_TRIBE_MISMATCH on Race', () => {
    const result = inspect({ Race: 'Hyur', Tribe: 'Xaela' });
    expect(result.identity.canonicalRace).toBe('Au Ra');
    expect(result.identity.raceSource).toBe('tribe');
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'RACE_TRIBE_MISMATCH', path: ['Race'] }),
    ]);
  });
  it('reports nothing when they agree, in either spelling', () => {
    expect(codes({ Race: "Miqo'te", Tribe: 'SeekerOfTheSun' })).toEqual([]);
    expect(codes({ Race: 'Miqote', Tribe: 'KeeperOfTheMoon' })).toEqual([]);
    expect(codes({ Race: 4, Tribe: 8 })).toEqual([]);
  });
  it('reports an unknown name or number as UNSUPPORTED_VALUE and anything else as INVALID_FIELD', () => {
    expect(codes({ Race: 'FutureRace' })).toEqual([
      ['UNSUPPORTED_VALUE', 'Race'],
    ]);
    expect(codes({ Race: 99 })).toEqual([['UNSUPPORTED_VALUE', 'Race']]);
    expect(codes({ Race: 255 })).toEqual([['UNSUPPORTED_VALUE', 'Race']]);
    for (const race of [256, -1, 1.5, true, [], {}])
      expect(codes({ Race: race }), JSON.stringify(race)).toEqual([
        ['INVALID_FIELD', 'Race'],
      ]);
  });
  it('gives an unsupported tribe no canonical race, even with a valid Race', () => {
    const result = inspect({ Race: 'Hyur', Tribe: 'FutureTribe' });
    expect(result.identity.tribe.state).toBe('unsupported');
    expect(result.identity.canonicalRace).toBeNull();
    expect(result.identity.raceSource).toBeNull();
    expect(result.identity.race).toMatchObject({
      state: 'valid',
      value: 'Hyur',
    });
    expect(
      result.issues.map((issue) => [issue.code, issue.path.join('.')]),
    ).toEqual([['UNSUPPORTED_VALUE', 'Tribe']]);
  });
  it('falls back to Race only when Tribe is absent or null', () => {
    for (const tribe of [{}, { Tribe: null }]) {
      const result = inspect({ Race: 'Elezen', ...tribe });
      expect(result.identity.canonicalRace).toBe('Elezen');
      expect(result.identity.raceSource).toBe('race');
    }
  });
});

describe('numeric and alias forms of the enumerations', () => {
  const RACES = [
    'Hyur',
    'Elezen',
    'Lalafell',
    "Miqo'te",
    'Roegadyn',
    'Au Ra',
    'Hrothgar',
    'Viera',
  ];
  const TRIBES: [string, string][] = [
    ['Midlander', 'Hyur'],
    ['Highlander', 'Hyur'],
    ['Wildwood', 'Elezen'],
    ['Duskwight', 'Elezen'],
    ['Plainsfolk', 'Lalafell'],
    ['Dunesfolk', 'Lalafell'],
    ['SeekerOfTheSun', "Miqo'te"],
    ['KeeperOfTheMoon', "Miqo'te"],
    ['SeaWolf', 'Roegadyn'],
    ['Hellsguard', 'Roegadyn'],
    ['Raen', 'Au Ra'],
    ['Xaela', 'Au Ra'],
    ['Helions', 'Hrothgar'],
    ['TheLost', 'Hrothgar'],
    ['Rava', 'Viera'],
    ['Veena', 'Viera'],
  ];
  it('reads Race 1 to 8 and rejects 0 and 9', () => {
    for (const [i, name] of RACES.entries())
      expect(
        inspect({ Race: i + 1 }).identity.race,
        String(i + 1),
      ).toMatchObject({
        state: 'valid',
        value: name,
      });
    for (const race of [0, 9])
      expect(inspect({ Race: race }).identity.race.state).toBe('unsupported');
  });
  it('reads Tribe 1 to 16 with the race each belongs to, and rejects 0 and 17', () => {
    TRIBES.forEach(([tribe, race], i) => {
      const byNumber = inspect({ Tribe: i + 1 }).identity;
      expect(byNumber.tribe, String(i + 1)).toMatchObject({
        state: 'valid',
        value: tribe,
      });
      expect(byNumber.canonicalRace, tribe).toBe(race);
      expect(inspect({ Tribe: tribe }).identity.canonicalRace, tribe).toBe(
        race,
      );
    });
    for (const tribe of [0, 17])
      expect(inspect({ Tribe: tribe }).identity.tribe.state).toBe(
        'unsupported',
      );
  });
  it('reads Gender 0 and 1, and rejects 2', () => {
    expect(inspect({ Gender: 0 }).identity.gender).toMatchObject({
      value: 'Masculine',
    });
    expect(inspect({ Gender: 1 }).identity.gender).toMatchObject({
      value: 'Feminine',
    });
    expect(inspect({ Gender: 'Feminine' }).identity.gender).toMatchObject({
      value: 'Feminine',
    });
    expect(inspect({ Gender: 2 }).identity.gender.state).toBe('unsupported');
    expect(inspect({ Gender: 'masculine' }).identity.gender.state).toBe(
      'unsupported',
    );
  });
  it('reads Age 0, 1, 3 and 4 as None, Normal, Old and Young, and rejects 2 and 5', () => {
    for (const [age, name] of [
      [0, 'None'],
      [1, 'Normal'],
      [3, 'Old'],
      [4, 'Young'],
    ] as const) {
      expect(inspect({ Age: age }).identity.age, String(age)).toMatchObject({
        state: 'valid',
        value: name,
      });
      expect(inspect({ Age: name }).identity.age).toMatchObject({
        value: name,
      });
    }
    for (const age of [2, 5, 255, 'Ancient'])
      expect(inspect({ Age: age }).identity.age.state, String(age)).toBe(
        'unsupported',
      );
    expect(inspect({ Age: 256 }).identity.age.state).toBe('invalid');
  });
  it('accepts the three race spellings and the legacy tribe name, and nothing like them', () => {
    for (const [stored, race] of [
      ['Lalafel', 'Lalafell'],
      ['Lalafell', 'Lalafell'],
      ['Miqote', "Miqo'te"],
      ["Miqo'te", "Miqo'te"],
      ['AuRa', 'Au Ra'],
      ['Au Ra', 'Au Ra'],
    ] as const)
      expect(inspect({ Race: stored }).identity.race, stored).toMatchObject({
        state: 'valid',
        value: race,
      });
    expect(inspect({ Tribe: 'Helion' }).identity.tribe).toMatchObject({
      state: 'valid',
      value: 'Helions',
      raw: 'Helion',
    });
    for (const stored of ['lalafel', 'Aura', "Miqo'Te", 'Au  Ra'])
      expect(inspect({ Race: stored }).identity.race.state, stored).toBe(
        'unsupported',
      );
  });
});

describe('vectors and the facial feature flags', () => {
  const extended = (fields: Record<string, unknown>, key: string) =>
    inspect(fields).extended[key as 'SkinColor'];
  it('reads a string vector of the right count and numeric parts, trimming spaces', () => {
    expect(extended({ SkinColor: '1, 2 ,3' }, 'SkinColor')).toMatchObject({
      state: 'valid',
      value: [1, 2, 3],
    });
    expect(extended({ SkinColor: '1e2,-0.5,+3' }, 'SkinColor')).toMatchObject({
      value: [100, -0.5, 3],
    });
    for (const bad of [
      '1,2',
      '1,2,3,4',
      '',
      '1,,3',
      'a,b,c',
      '1,2,0x3',
      '1,2,NaN',
      '1,2,Infinity',
    ])
      expect(extended({ SkinColor: bad }, 'SkinColor').state, bad).toBe(
        'invalid',
      );
  });
  it('limits each part of a string vector to 64 characters', () => {
    const part = (length: number) => `0.${'0'.repeat(length - 2)}`;
    expect(extended({ SkinColor: `${part(64)},1,1` }, 'SkinColor').state).toBe(
      'valid',
    );
    expect(extended({ SkinColor: `${part(65)},1,1` }, 'SkinColor').state).toBe(
      'invalid',
    );
    expect(extended({ SkinColor: `1,${part(65)},1` }, 'SkinColor').state).toBe(
      'invalid',
    );
  });
  it('requires the right number of components in an array', () => {
    expect(extended({ SkinColor: [1, 2, 3] }, 'SkinColor')).toMatchObject({
      value: [1, 2, 3],
    });
    for (const bad of [
      [1, 2],
      [1, 2, 3, 4],
      [],
      [1, 2, '3'],
      [1, 2, null],
      [1, [2], 3],
    ])
      expect(
        extended({ SkinColor: bad }, 'SkinColor').state,
        JSON.stringify(bad),
      ).toBe('invalid');
    expect(
      extended({ MouthColor: [1, 2, 3, 0.5] }, 'MouthColor'),
    ).toMatchObject({
      value: [1, 2, 3, 0.5],
    });
    expect(extended({ MouthColor: [1, 2, 3] }, 'MouthColor').state).toBe(
      'invalid',
    );
  });
  it('reads the R, G, B and A lanes of a record, or X, Y, Z and W when there is no R', () => {
    expect(
      extended({ SkinColor: { R: 1, G: 2, B: 3 } }, 'SkinColor'),
    ).toMatchObject({
      value: [1, 2, 3],
    });
    expect(
      extended({ SkinColor: { R: 1, G: 2, B: 3, Q: 9 } }, 'SkinColor'),
    ).toMatchObject({
      value: [1, 2, 3],
    });
    expect(
      extended({ MouthColor: { R: 1, G: 2, B: 3, A: 0.25 } }, 'MouthColor'),
    ).toMatchObject({
      value: [1, 2, 3, 0.25],
    });
    expect(
      extended({ BustScale: { X: 1, Y: 2, Z: 3 } }, 'BustScale'),
    ).toMatchObject({
      value: [1, 2, 3],
    });
    for (const bad of [
      { R: 1, G: 2 },
      { R: 1, G: 2, B: '3' },
      { R: 1, X: 1, Y: 2, Z: 3 },
    ])
      expect(
        extended({ SkinColor: bad }, 'SkinColor').state,
        JSON.stringify(bad),
      ).toBe('invalid');
    expect(
      extended({ MouthColor: { R: 1, G: 2, B: 3 } }, 'MouthColor').state,
    ).toBe('invalid');
  });
  it('reads FacialFeatures as a byte, None, or up to eight known names', () => {
    const flags = (value: unknown) =>
      inspect({ FacialFeatures: value }).appearance.FacialFeatures;
    for (const [stored, value] of [
      [0, 0],
      [255, 255],
      ['None', 0],
      ['First', 1],
      ['First,Second', 3],
      [' First , LegacyTattoo ', 129],
      ['Seventh', 64],
      ['First,Second,Third,Fourth,Fifth,Sixth,Seventh,LegacyTattoo', 255],
    ] as const)
      expect(flags(stored), String(stored)).toMatchObject({
        state: 'valid',
        value,
      });
    expect(flags(256).state).toBe('invalid');
    expect(flags(-1).state).toBe('invalid');
    expect(flags(1.5).state).toBe('invalid');
    expect(flags(true).state).toBe('invalid');
    for (const bad of [
      '',
      'first',
      'Eighth',
      'First,',
      ',First',
      'First,Nope',
      'First Second',
    ])
      expect(flags(bad).state, JSON.stringify(bad)).toBe('unsupported');
    // More than eight parts is refused even when every one of them is a known name.
    expect(
      flags('First,First,First,First,First,First,First,First,First').state,
    ).toBe('unsupported');
  });
});

describe('metadata fields', () => {
  const NUMERIC = ['SaveMode', 'FileVersion', 'Version', 'ObjectKind'];
  const TEXT = [
    'TypeName',
    '$type',
    'FileExtension',
    'Author',
    'Description',
    'Nickname',
  ];
  it('takes text for every metadata field', () => {
    for (const key of [...NUMERIC, ...TEXT])
      expect(
        inspect({ [key]: 'x' }).metadata[key as 'Author'],
        key,
      ).toMatchObject({
        state: 'valid',
        value: 'x',
      });
  });
  it('takes a number only for SaveMode, FileVersion, Version and ObjectKind', () => {
    for (const key of NUMERIC)
      expect(
        inspect({ [key]: 2 }).metadata[key as 'Version'],
        key,
      ).toMatchObject({
        state: 'valid',
        value: 2,
      });
    for (const key of TEXT) {
      const result = inspect({ [key]: 5 });
      expect(result.metadata[key as 'Author'].state, key).toBe('invalid');
      expect(result.issues).toEqual([
        expect.objectContaining({ code: 'INVALID_FIELD', path: [key] }),
      ]);
    }
  });
  it('bounds those numbers at 0xffffffff and refuses fractions and negatives', () => {
    for (const key of NUMERIC) {
      expect(
        inspect({ [key]: 4294967295 }).metadata[key as 'Version'].state,
        key,
      ).toBe('valid');
      for (const bad of [4294967296, -1, 1.5, true, [], {}])
        expect(
          inspect({ [key]: bad }).metadata[key as 'Version'].state,
          `${key} ${JSON.stringify(bad)}`,
        ).toBe('invalid');
    }
  });
});

describe('the combined diagnostic cap', () => {
  it('holds the reader and the inspection issues to 64 together, with the marker last', () => {
    // 60 unknown fields (reader) and 12 inspection issues (8 invalid byte fields, 4 unsupported
    // identity values): 72 issues in all.
    const unknown = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`Unknown${i}`, 1]),
    );
    const invalid = Object.fromEntries(
      [
        'Height',
        'Head',
        'Hair',
        'Skintone',
        'REyeColor',
        'HairTone',
        'Highlights',
        'LimbalEyes',
      ].map((key) => [key, 'bad'] as const),
    );
    const result = inspect({
      ...unknown,
      ...invalid,
      Race: 'x',
      Tribe: 'x',
      Gender: 'x',
      Age: 'x',
    });
    expect(result.issues).toHaveLength(64);
    expect(result.issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    expect(
      result.issues.filter((issue) => issue.code === 'ISSUES_TRUNCATED'),
    ).toHaveLength(1);
    // Reader issues come first, in order, then the inspection's.
    expect(result.issues.slice(0, 3).map((issue) => issue.path[0])).toEqual([
      'Unknown0',
      'Unknown1',
      'Unknown2',
    ]);
  });
  it('does not add a marker below the cap', () => {
    const result = inspect({ Unknown0: 1, Unknown1: 1, Race: 'x' });
    expect(result.issues).toHaveLength(3);
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      'ISSUES_TRUNCATED',
    );
  });
});

describe('edge cases found in review', () => {
  describe('which lanes make a model worn', () => {
    it('does not count a variant for armor, either', () => {
      const body = inspect({ Body: { ModelBase: 0, ModelVariant: 5 } })
        .equipment.Body;
      expect(body.status).toBe('empty');
      expect(body.model).toEqual({ slot: 'Body', base: 0, variant: 5 });
    });
    it('accepts the largest lane values, and refuses one more', () => {
      const worn = inspect({
        Body: {
          ModelBase: 65535,
          ModelVariant: 65535,
          DyeId: 65535,
          DyeId2: 65535,
        },
      });
      expect(worn.equipment.Body).toMatchObject({
        status: 'worn',
        model: { slot: 'Body', base: 65535, variant: 65535 },
        dye1: { state: 'valid', value: 65535 },
        dye2: { state: 'valid', value: 65535 },
      });
      expect(worn.issues).toEqual([]);
      const over = inspect({
        Body: { ModelBase: 1, ModelVariant: 1, DyeId: 65536, DyeId2: 65536 },
      });
      expect(over.equipment.Body.dye1.state).toBe('invalid');
      expect(over.equipment.Body.dye2.state).toBe('invalid');
      expect(over.issues.map((issue) => issue.path)).toEqual([
        ['Body', 'DyeId'],
        ['Body', 'DyeId2'],
      ]);
    });
    it('names the exact lane in the issue for a lane that is stored but unusable', () => {
      for (const slot of ['MainHand', 'OffHand'] as const)
        for (const set of ['x', '5', -1, 65536, 1.5, true]) {
          const result = inspect({
            [slot]: { ModelSet: set, ModelBase: 1, ModelVariant: 1 },
          });
          expect(
            result.issues.map((issue) => [issue.code, issue.path]),
            `${slot} ${JSON.stringify(set)}`,
          ).toEqual([
            ['INVALID_FIELD', [slot, 'ModelSet']],
            ['INCOMPLETE_MODEL', [slot]],
          ]);
        }
      // A missing or null lane is not an invalid field, only an incomplete model.
      for (const stored of [
        { ModelBase: 1, ModelVariant: 1 },
        { ModelSet: null, ModelBase: 1, ModelVariant: 1 },
      ])
        expect(
          inspect({ MainHand: stored }).issues.map((issue) => [
            issue.code,
            issue.path,
          ]),
        ).toEqual([['INCOMPLETE_MODEL', ['MainHand']]]);
      expect(
        inspect({
          Body: { ModelBase: 1, ModelVariant: 1, DyeId: 'x' },
        }).issues.map((issue) => issue.path),
      ).toEqual([['Body', 'DyeId']]);
    });
    it('accepts a ModelType of up to 32 bits', () => {
      for (const value of [0, 70000, 4294967295])
        expect(inspect({ ModelType: value }).identity.modelType).toMatchObject({
          state: 'valid',
          value,
        });
      for (const value of [4294967296, -1, 1.5, '1'])
        expect(inspect({ ModelType: value }).identity.modelType.state).toBe(
          'invalid',
        );
    });
  });

  describe('identity', () => {
    it('does not fall back to Race when the Tribe is stored but unusable', () => {
      for (const tribe of [300, 1.5, -1, true, [], {}]) {
        const result = inspect({ Race: 'Hyur', Tribe: tribe });
        expect(result.identity.canonicalRace, JSON.stringify(tribe)).toBeNull();
        expect(result.identity.raceSource).toBeNull();
        expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
          ['INVALID_FIELD', ['Tribe']],
        ]);
      }
    });
    it('reports no mismatch for a Race that has no value', () => {
      expect(codes({ Race: 'FutureRace', Tribe: 'Dunesfolk' })).toEqual([
        ['UNSUPPORTED_VALUE', 'Race'],
      ]);
      expect(codes({ Race: 300, Tribe: 'Dunesfolk' })).toEqual([
        ['INVALID_FIELD', 'Race'],
      ]);
      expect(
        inspect({ Race: 'FutureRace', Tribe: 'Dunesfolk' }).identity
          .canonicalRace,
      ).toBe('Lalafell');
    });
    it('does not read a number written as text', () => {
      for (const [key, value] of [
        ['Race', '1'],
        ['Tribe', '13'],
        ['Gender', '0'],
        ['Age', '1'],
        ['Age', '0'],
      ] as const) {
        const result = inspect({ [key]: value });
        expect(
          result.identity[key.toLowerCase() as 'race'].state,
          `${key} ${value}`,
        ).toBe('unsupported');
        expect(result.issues.map((issue) => issue.code)).toEqual([
          'UNSUPPORTED_VALUE',
        ]);
      }
    });
  });

  describe('vectors', () => {
    const skin = (value: unknown) =>
      inspect({ SkinColor: value }).extended.SkinColor;
    it('reads an exponent of either case and either sign, as .NET writes small floats', () => {
      for (const [text, expected] of [
        ['1E-05, 0.5, 0.25', [0.00001, 0.5, 0.25]],
        ['1e-05, 0.5, 0.25', [0.00001, 0.5, 0.25]],
        ['2.5e+3, 1, 1', [2500, 1, 1]],
        ['-1E2, 0, 0', [-100, 0, 0]],
        ['9.99E-05, 0, 0', [0.0000999, 0, 0]],
      ] as const)
        expect(skin(text), text).toMatchObject({
          state: 'valid',
          value: expected,
        });
      for (const text of ['1e, 0, 0', '1e+, 0, 0', '1E-, 0, 0', '1e5.5, 0, 0'])
        expect(skin(text).state, text).toBe('invalid');
    });
    it('reads a four-lane record in either spelling, and refuses one lane short', () => {
      const mouth = (value: unknown) =>
        inspect({ MouthColor: value }).extended.MouthColor;
      expect(mouth({ X: 0.5, Y: 0.25, Z: 0, W: 0.75 })).toMatchObject({
        state: 'valid',
        value: [0.5, 0.25, 0, 0.75],
      });
      expect(mouth({ R: 0.5, G: 0.25, B: 0, A: 0.75 })).toMatchObject({
        state: 'valid',
        value: [0.5, 0.25, 0, 0.75],
      });
      expect(mouth({ X: 0.5, Y: 0.25, Z: 0 }).state).toBe('invalid');
      expect(mouth({ R: 0.5, G: 0.25, B: 0 }).state).toBe('invalid');
    });
    it('reads MouthColor from the committed Brio export that stores it as X, Y, Z and W', async () => {
      const bytes = await readFile(
        new URL('../../../fixtures/brio/extended.chara', import.meta.url),
      );
      const stored = JSON.parse(bytes.toString('utf8')).MouthColor;
      expect(Object.keys(stored).sort()).toEqual(['W', 'X', 'Y', 'Z']);
      const mouth = inspectChara(readChara(bytes)).extended.MouthColor;
      expect(mouth).toMatchObject({
        state: 'valid',
        value: [stored.X, stored.Y, stored.Z, stored.W],
      });
    });
  });

  describe('facial feature lists', () => {
    const flags = (value: unknown) =>
      inspect({ FacialFeatures: value }).appearance.FacialFeatures;
    it('combines names with OR, so a repeated name adds nothing', () => {
      expect(flags('Seventh,Seventh')).toMatchObject({
        state: 'valid',
        value: 64,
      });
      expect(flags('LegacyTattoo,LegacyTattoo')).toMatchObject({
        state: 'valid',
        value: 128,
      });
      expect(flags('First,Second,First')).toMatchObject({
        state: 'valid',
        value: 3,
      });
    });
    it('takes None only on its own', () => {
      expect(flags('None, First').state).toBe('unsupported');
      expect(flags('First,None').state).toBe('unsupported');
      expect(flags('None')).toMatchObject({ state: 'valid', value: 0 });
    });
  });
});
