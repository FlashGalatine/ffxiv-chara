import { describe, expect, it } from 'vitest';
import {
  associated,
  normalizeRow,
  normalizeStainRow,
} from '../src/xivapi/rows.js';
import type { GlassesRow, ItemRow, StainRow } from '../src/xivapi/types.js';

// What a row from XIVAPI must look like before it is trusted, and how it is tied back to the lookup
// that asked for it. A value outside its range is unknown (null), not an error, unless the row can no
// longer be used as an item: its id, sheet, names, ModelMain and slot columns.

const UINT32 = 4_294_967_295;
const UINT48 = 281_474_976_710_655;
type Fields = Record<string, unknown>;
const raw = (fields: Fields = {}, rest: Fields = {}) => ({
  row_id: 7,
  fields: {
    ModelMain: 5,
    EquipSlotCategory: { fields: { Body: 1 } },
    ...fields,
  },
  ...rest,
});
const item = (
  fields: Fields = {},
  rest: Fields = {},
  languages = ['en'] as const,
) => normalizeRow(raw(fields, rest), languages, true) as ItemRow | null;
const glasses = (value: unknown) =>
  normalizeRow(value, ['en', 'ja'], false) as GlassesRow | null;
const stain = (value: unknown, languages = ['en'] as const) =>
  normalizeStainRow(value, languages);
const named = (name: unknown, id: unknown = 3, rest: Fields = {}) => ({
  row_id: id,
  fields: { 'Name@lang(en)': name },
  ...rest,
});

describe('an item row', () => {
  it('reads the smallest row that can be used', () => {
    expect(item()).toEqual({
      rowId: 7,
      names: {},
      iconId: null,
      modelMain: '5',
      modelSub: null,
      slots: ['Body'],
      levelEquip: null,
      uiCategory: null,
      rules: {
        dyeCount: null,
        glamourable: null,
        wear: {},
        grandCompany: null,
      },
    });
  });

  it.each([
    ['zero', 0, 0],
    ['the largest 32-bit id', UINT32, UINT32],
  ])('accepts %s as the row id', (_name, id, expected) => {
    const row = normalizeRow(raw({}, { row_id: id }), ['en'], true);
    expect(row).toMatchObject({ rowId: expected });
  });

  it.each([
    ['one above 32 bits', UINT32 + 1],
    ['negative', -1],
    ['a fraction', 1.5],
    ['text', '7'],
    ['NaN', Number.NaN],
    ['beyond the safe range', 2 ** 53],
    ['null', null],
    ['absent', undefined],
  ])('refuses %s as the row id', (_name, id) => {
    expect(normalizeRow(raw({}, { row_id: id }), ['en'], true)).toBeNull();
  });

  it.each([null, 'x', 7, [], undefined])(
    'refuses %j instead of a row',
    (value) => {
      expect(normalizeRow(value, ['en'], true)).toBeNull();
    },
  );

  it.each([null, 'x', 7, [], undefined])(
    'refuses %j instead of fields',
    (fields) => {
      expect(normalizeRow({ row_id: 7, fields }, ['en'], true)).toBeNull();
    },
  );

  it('accepts the sheet name Item, or none, and refuses any other', () => {
    expect(item({}, { sheet: 'Item' })).not.toBeNull();
    expect(item({}, { sheet: undefined })).not.toBeNull();
    for (const sheet of ['Glasses', 'item', 'Stain', '', 7, null])
      expect(item({}, { sheet })).toBeNull();
  });

  it('reads a name of 1,024 characters and refuses one of 1,025 or one that is not text', () => {
    expect(item({ 'Name@lang(en)': 'x'.repeat(1024) })?.names.en).toHaveLength(
      1024,
    );
    for (const name of ['x'.repeat(1025), 7, null, {}, ['a']])
      expect(item({ 'Name@lang(en)': name })).toBeNull();
  });

  it('reads the names of the requested languages only, and leaves a missing one out', () => {
    const fields = {
      'Name@lang(en)': 'Coat',
      'Name@lang(ja)': 'コート',
      'Name@lang(de)': 'Mantel',
    };
    expect(item(fields, {}, ['en'])?.names).toEqual({ en: 'Coat' });
    expect(normalizeRow(raw(fields), ['en', 'ja'], true)?.names).toEqual({
      en: 'Coat',
      ja: 'コート',
    });
    expect(normalizeRow(raw(fields), ['fr'], true)?.names).toEqual({});
  });

  it.each([
    ['zero', 0, '0'],
    ['a large id', 328041, '328041'],
    ['the largest 48-bit id', UINT48, String(UINT48)],
  ])('keeps ModelMain %s as a decimal string', (_name, value, text) => {
    expect(item({ ModelMain: value })?.modelMain).toBe(text);
  });

  it.each([
    ['one above 48 bits', UINT48 + 1],
    ['negative', -1],
    ['a fraction', 1.5],
    ['text', '5'],
    ['null', null],
    ['absent', undefined],
  ])('refuses a row whose ModelMain is %s', (_name, value) => {
    expect(item({ ModelMain: value })).toBeNull();
  });

  it('keeps the row but not the value when ModelSub is out of range', () => {
    expect(item({ ModelSub: 0 })?.modelSub).toBe('0');
    expect(item({ ModelSub: UINT48 })?.modelSub).toBe(String(UINT48));
    for (const value of [UINT48 + 1, -1, 1.5, '5', null, undefined])
      expect(item({ ModelSub: value })).toMatchObject({
        rowId: 7,
        modelSub: null,
      });
  });

  it.each([
    ['EquipSlotCategory is missing', { EquipSlotCategory: undefined }],
    ['EquipSlotCategory is not a record', { EquipSlotCategory: 1 }],
    ['EquipSlotCategory has no fields', { EquipSlotCategory: {} }],
    [
      'EquipSlotCategory fields is not a record',
      { EquipSlotCategory: { fields: 1 } },
    ],
  ])('refuses a row when %s', (_name, fields) => {
    expect(item(fields)).toBeNull();
  });

  it('maps each slot column to its slot, and lists the slots in a fixed order', () => {
    const columns: [string, string][] = [
      ['MainHand', 'MainHand'],
      ['OffHand', 'OffHand'],
      ['HeadGear', 'Head'],
      ['Body', 'Body'],
      ['Hands', 'Gloves'],
      ['Legs', 'Legs'],
      ['Feet', 'Feet'],
      ['Ears', 'Ears'],
      ['Neck', 'Neck'],
      ['Wrists', 'Wrists'],
      ['LeftRing', 'FingerL'],
      ['RightRing', 'FingerR'],
    ];
    for (const [slot, column] of columns)
      expect(
        item({ EquipSlotCategory: { fields: { [column]: 1 } } })?.slots,
      ).toEqual([slot]);
    const all = Object.fromEntries(columns.map(([, column]) => [column, 1]));
    expect(item({ EquipSlotCategory: { fields: all } })?.slots).toEqual(
      columns.map(([slot]) => slot),
    );
    const reversed = Object.fromEntries(
      [...columns].reverse().map(([, c]) => [c, true]),
    );
    expect(item({ EquipSlotCategory: { fields: reversed } })?.slots).toEqual(
      columns.map(([slot]) => slot),
    );
  });

  it('counts a slot column only when it is 1 or true', () => {
    const slots = (value: unknown) =>
      item({ EquipSlotCategory: { fields: { Body: value } } })?.slots;
    expect(slots(1)).toEqual(['Body']);
    expect(slots(true)).toEqual(['Body']);
    for (const value of [0, false, 2, -1, '1', 'true', null, undefined, {}])
      expect(slots(value)).toEqual([]);
    expect(
      item({ EquipSlotCategory: { fields: { Unknown: 1 } } })?.slots,
    ).toEqual([]);
  });

  it('keeps LevelEquip up to 65,535 and treats a larger or malformed one as unknown', () => {
    expect(item({ LevelEquip: 0 })?.levelEquip).toBe(0);
    expect(item({ LevelEquip: 65_535 })?.levelEquip).toBe(65_535);
    for (const value of [65_536, -1, 1.5, '70', null, undefined])
      expect(item({ LevelEquip: value })?.levelEquip).toBeNull();
  });

  it('keeps a dye count of 0 to 2 and treats any other as unknown', () => {
    for (const value of [0, 1, 2])
      expect(item({ DyeCount: value })?.rules.dyeCount).toBe(value);
    for (const value of [3, 255, -1, 1.5, '2', null, undefined])
      expect(item({ DyeCount: value })?.rules.dyeCount).toBeNull();
  });

  it('reads a flag only from true, false, 1 or 0', () => {
    for (const [value, expected] of [
      [true, true],
      [1, true],
      [false, false],
      [0, false],
    ] as const)
      expect(item({ IsGlamorous: value })?.rules.glamourable).toBe(expected);
    for (const value of [2, -1, 'true', '1', null, {}, undefined])
      expect(item({ IsGlamorous: value })?.rules.glamourable).toBeNull();
  });

  it('reads the category and the Grand Company from a row_id up to 32 bits', () => {
    for (const [field, read] of [
      ['ItemUICategory', (row: ItemRow | null) => row?.uiCategory],
      ['GrandCompany', (row: ItemRow | null) => row?.rules.grandCompany],
    ] as const) {
      expect(read(item({ [field]: { row_id: 0 } }))).toBe(0);
      expect(read(item({ [field]: { row_id: UINT32 } }))).toBe(UINT32);
      for (const value of [
        { row_id: UINT32 + 1 },
        { row_id: -1 },
        { row_id: '3' },
        {},
        3,
        null,
        undefined,
      ])
        expect(read(item({ [field]: value }))).toBeNull();
    }
  });

  it('reads the icon id from a record, up to 32 bits', () => {
    const icon = (value: unknown) =>
      glasses({ row_id: 1, fields: { Icon: value } })?.iconId;
    expect(icon({ id: 0 })).toBe(0);
    expect(icon({ id: UINT32 })).toBe(UINT32);
    for (const value of [
      { id: UINT32 + 1 },
      { id: -1 },
      { id: '5' },
      {},
      5,
      null,
      undefined,
    ])
      expect(icon(value)).toBeNull();
  });

  it('keeps only the listed wear columns, as booleans', () => {
    const wear = item({
      EquipRestriction: {
        fields: {
          Hyur: 1,
          Elezen: 0,
          Lalafell: true,
          Miqote: false,
          Roegadyn: 2,
          AuRa: 'x',
          Hrothgar: null,
          Viera: 1,
          Male: 1,
          Female: 0,
          Unlisted: 1,
        },
      },
    })?.rules.wear;
    expect(wear).toEqual({
      Hyur: true,
      Elezen: false,
      Lalafell: true,
      Miqote: false,
      Viera: true,
      Male: true,
      Female: false,
    });
    expect(item({ EquipRestriction: 1 })?.rules.wear).toEqual({});
    expect(item({ EquipRestriction: { fields: 1 } })?.rules.wear).toEqual({});
  });
});

describe('a glasses row', () => {
  it('has a row id, names and an icon, and nothing else', () => {
    expect(
      glasses({
        row_id: 8,
        fields: {
          'Name@lang(en)': 'Glasses',
          'Name@lang(ja)': 'めがね',
          Icon: { id: 3 },
        },
      }),
    ).toEqual({ rowId: 8, names: { en: 'Glasses', ja: 'めがね' }, iconId: 3 });
  });

  it('accepts the sheet name Glasses, or none, and refuses any other', () => {
    const row = (sheet: unknown) => glasses({ row_id: 8, fields: {}, sheet });
    expect(row('Glasses')).not.toBeNull();
    expect(row(undefined)).not.toBeNull();
    for (const sheet of ['Item', 'Stain', 'glasses', '', 8])
      expect(row(sheet)).toBeNull();
  });

  it('limits a name to 1,024 characters', () => {
    const row = (name: unknown) =>
      glasses({ row_id: 8, fields: { 'Name@lang(en)': name } });
    expect(row('x'.repeat(1024))).not.toBeNull();
    expect(row('x'.repeat(1025))).toBeNull();
    expect(row(5)).toBeNull();
  });
});

describe('a dye row', () => {
  it('has a row id and a trimmed name for every requested language', () => {
    expect(stain(named(' Ash Grey '))).toEqual({
      rowId: 3,
      names: { en: 'Ash Grey' },
    });
    expect(
      stain(
        {
          row_id: 3,
          fields: {
            'Name@lang(en)': 'Ash',
            'Name@lang(ja)': 'アッシュ',
            'Name@lang(de)': 'Asch',
          },
        },
        ['en', 'ja'] as never,
      ),
    ).toEqual({ rowId: 3, names: { en: 'Ash', ja: 'アッシュ' } });
  });

  it('refuses a row that lacks a requested language, or whose name is not text', () => {
    expect(stain({ row_id: 3, fields: {} })).toBeNull();
    expect(stain(named(undefined))).toBeNull();
    for (const name of [5, null, {}, ['x']])
      expect(stain(named(name))).toBeNull();
    expect(
      stain({ row_id: 3, fields: { 'Name@lang(en)': 'Ash' } }, [
        'en',
        'ja',
      ] as never),
    ).toBeNull();
  });

  it('limits a name to 1,024 characters before trimming', () => {
    expect(stain(named('x'.repeat(1024)))).not.toBeNull();
    expect(stain(named('x'.repeat(1025)))).toBeNull();
    // The length is checked as received: padding that would be trimmed away still counts.
    expect(stain(named(`  ${'x'.repeat(1020)}`))?.names.en).toHaveLength(1020);
    expect(stain(named(`${'x'.repeat(1022)}   `))).toBeNull();
  });

  it('accepts a row id up to 65,535 and refuses a larger or malformed one', () => {
    expect(stain(named('A', 0))).not.toBeNull();
    expect(stain(named('A', 65_535))).not.toBeNull();
    for (const id of [65_536, -1, 1.5, '3', null])
      expect(stain(named('A', id))).toBeNull();
    expect(stain({ fields: { 'Name@lang(en)': 'A' } })).toBeNull();
  });

  it('accepts the sheet name Stain, or none, and refuses any other', () => {
    expect(stain(named('A', 3, { sheet: 'Stain' }))).not.toBeNull();
    for (const sheet of ['Item', 'stain', '', 3, null])
      expect(stain(named('A', 3, { sheet }))).toBeNull();
  });

  it.each([null, 'x', 5, [], undefined])(
    'refuses %j instead of a row',
    (value) => {
      expect(stain(value)).toBeNull();
    },
  );
});

describe('whether a row belongs to the lookup that received it', () => {
  const bodyItem = (
    rowId: number,
    modelMain: string,
    slots: ItemRow['slots'],
  ): ItemRow => ({
    rowId,
    names: {},
    iconId: null,
    modelMain,
    modelSub: null,
    slots,
    levelEquip: null,
    uiCategory: null,
    rules: { dyeCount: null, glamourable: null, wear: {}, grandCompany: null },
  });
  const glassesRow: GlassesRow = { rowId: 8, names: {}, iconId: null };
  const stainRow: StainRow = { rowId: 3, names: { en: 'Ash' } };

  it('requires a dye row to be one of the dyes asked for, and to be only a dye', () => {
    const lookup = { stains: [2, 3] };
    expect(associated(stainRow, lookup)).toBe(true);
    expect(associated({ ...stainRow, rowId: 4 }, lookup)).toBe(false);
    expect(associated(glassesRow, lookup)).toBe(false);
    expect(associated(bodyItem(3, '5', ['Body']), lookup)).toBe(false);
  });

  it('requires a glasses row to have the id asked for, and to be only glasses', () => {
    expect(associated(glassesRow, 8)).toBe(true);
    expect(associated({ ...glassesRow, rowId: 9 }, 8)).toBe(false);
    expect(associated(bodyItem(8, '5', ['Body']), 8)).toBe(false);
    expect(associated(stainRow, 3)).toBe(false);
    expect(associated({ rowId: 0, names: {}, iconId: null }, 0)).toBe(true);
  });

  it('requires an item to have a model and a slot that were asked for together', () => {
    const lookups = [
      { slot: 'Body' as const, key: '5' },
      { slot: 'Feet' as const, key: '9' },
    ];
    expect(associated(bodyItem(1, '5', ['Body']), lookups)).toBe(true);
    expect(associated(bodyItem(1, '9', ['Body', 'Feet']), lookups)).toBe(true);
    // The model is asked for in another slot, or the slot with another model.
    expect(associated(bodyItem(1, '9', ['Body']), lookups)).toBe(false);
    expect(associated(bodyItem(1, '5', ['Feet']), lookups)).toBe(false);
    expect(associated(bodyItem(1, '6', ['Body']), lookups)).toBe(false);
    expect(associated(bodyItem(1, '5', []), lookups)).toBe(false);
    expect(associated(glassesRow, lookups)).toBe(false);
    expect(associated(stainRow, lookups)).toBe(false);
  });
});
