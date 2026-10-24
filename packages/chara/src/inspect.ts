import {
  BYTE_FIELDS,
  COLOR_FIELDS,
  EQUIPMENT_SLOTS,
  FLOAT_FIELDS,
  isRecord,
  METADATA_FIELDS,
} from './field-spec.js';
import { IssueCollector } from './issues.js';
import { isUint } from './models.js';
import type {
  CharaDocument,
  CharaInspection,
  EquipmentInspection,
  EquipmentModel,
  EquipmentSlot,
  Field,
  JsonRecord,
  JsonValue,
  Race,
} from './types.js';

const RACES: readonly Race[] = [
  'Hyur',
  'Elezen',
  'Lalafell',
  "Miqo'te",
  'Roegadyn',
  'Au Ra',
  'Hrothgar',
  'Viera',
];
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
const FLAG_NAMES = [
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'LegacyTattoo',
];
const raceAliases: ReadonlyMap<string, Race> = new Map([
  ['Lalafel', 'Lalafell'],
  ['Miqote', "Miqo'te"],
  ['AuRa', 'Au Ra'],
]);
const tribeAliases: ReadonlyMap<string, string> = new Map([
  ['Helion', 'Helions'],
]);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const numericToken = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function vector(raw: JsonValue, size: number): number[] | undefined {
  let values: unknown[];
  if (typeof raw === 'string') {
    const parts = raw.split(',');
    if (parts.length !== size) return undefined;
    if (
      parts.some((part) => part.length > 64 || !numericToken.test(part.trim()))
    )
      return undefined;
    values = parts.map((part) => Number(part.trim()));
  } else if (Array.isArray(raw)) values = raw;
  else if (isRecord(raw)) {
    const names = Object.hasOwn(raw, 'R')
      ? ['R', 'G', 'B', 'A']
      : ['X', 'Y', 'Z', 'W'];
    values = names
      .slice(0, size)
      .map((key) => (Object.hasOwn(raw, key) ? raw[key] : undefined));
  } else return undefined;
  if (values.length !== size || !values.every(finite)) return undefined;
  return values.slice() as number[];
}

class Inspector {
  readonly issues = new IssueCollector();
  constructor(readonly fields: JsonRecord) {}

  field<T>(
    fields: JsonRecord,
    key: string,
    decode: (raw: JsonValue) => T | undefined,
    path: (string | number)[] = [key],
    unsupported = false,
  ): Field<T> {
    if (!Object.hasOwn(fields, key)) return { state: 'absent' };
    const raw = fields[key] as JsonValue;
    if (raw === null) return { state: 'null', raw };
    const value = decode(raw);
    if (value !== undefined) return { state: 'valid', raw, value };
    const state =
      // These fields are bytes in the producers' files: a string or 0-255 that is not a known
      // value is unsupported, anything wider or of another type cannot be a producer value.
      unsupported && (typeof raw === 'string' || isUint(raw, 255))
        ? 'unsupported'
        : 'invalid';
    this.issues.add(
      state === 'unsupported' ? 'UNSUPPORTED_VALUE' : 'INVALID_FIELD',
      path,
      'Stored field has no valid supported interpretation.',
    );
    return { state, raw };
  }
  integer(
    fields: JsonRecord,
    key: string,
    max: number,
    path: string[] = [key],
  ): Field<number> {
    return this.field(
      fields,
      key,
      (raw) => (isUint(raw, max) ? raw : undefined),
      path,
    );
  }
  enumeration<T extends string>(
    key: string,
    values: readonly T[],
    start = 1,
    aliases?: ReadonlyMap<string, T>,
  ): Field<T> {
    return this.field(
      this.fields,
      key,
      (raw) => {
        if (typeof raw === 'number' && Number.isInteger(raw))
          return values[raw - start];
        if (typeof raw === 'string')
          return aliases?.get(raw) ?? values.find((value) => value === raw);
        return undefined;
      },
      [key],
      true,
    );
  }

  equipment(slot: EquipmentSlot): EquipmentInspection {
    const stored = this.field(this.fields, slot, (raw) =>
      isRecord(raw) ? raw : undefined,
    );
    const result: EquipmentInspection = {
      stored,
      status:
        stored.state === 'valid'
          ? 'invalid'
          : stored.state === 'unsupported'
            ? 'invalid'
            : stored.state,
      model: null,
      set: { state: 'absent' },
      base: { state: 'absent' },
      variant: { state: 'absent' },
      dye1: { state: 'absent' },
      dye2: { state: 'absent' },
    };
    if (stored.state !== 'valid') return result;
    const fields = stored.value;
    const weapon = slot === 'MainHand' || slot === 'OffHand';
    result.base = this.integer(fields, 'ModelBase', 65535, [slot, 'ModelBase']);
    result.variant = this.integer(fields, 'ModelVariant', 65535, [
      slot,
      'ModelVariant',
    ]);
    result.dye1 = this.integer(fields, 'DyeId', 65535, [slot, 'DyeId']);
    result.dye2 = this.integer(fields, 'DyeId2', 65535, [slot, 'DyeId2']);
    if (weapon)
      result.set = this.integer(fields, 'ModelSet', 65535, [slot, 'ModelSet']);
    if (
      result.base.state !== 'valid' ||
      result.variant.state !== 'valid' ||
      (weapon && result.set.state !== 'valid')
    ) {
      this.issues.add(
        'INCOMPLETE_MODEL',
        [slot],
        'Model lanes are missing, null, or invalid.',
      );
      return result;
    }
    const model: EquipmentModel = {
      slot,
      base: result.base.value,
      variant: result.variant.value,
    };
    if (weapon && result.set.state === 'valid') model.set = result.set.value;
    result.model = model;
    result.status =
      model.base > 0 || (weapon && (model.set ?? 0) > 0) ? 'worn' : 'empty';
    return result;
  }
}

export function inspectChara(document: CharaDocument): CharaInspection {
  const fields = document.fields;
  const reader = new Inspector(fields);
  // The reader's own truncation marker is not copied in the middle of the list: it is put back
  // as the final entry once every inspection diagnostic has been added.
  let readerTruncated = false;
  for (const issue of document.issues) {
    if (issue.code === 'ISSUES_TRUNCATED') readerTruncated = true;
    else
      reader.issues.add(issue.code, issue.path, issue.message, issue.severity);
  }
  const race = reader.enumeration('Race', RACES, 1, raceAliases);
  const tribe = reader.enumeration('Tribe', TRIBES, 1, tribeAliases);
  const gender = reader.enumeration(
    'Gender',
    ['Masculine', 'Feminine'] as const,
    0,
  );
  const age = reader.field(
    fields,
    'Age',
    (raw) => {
      if (
        typeof raw === 'string' &&
        ['None', 'Normal', 'Old', 'Young'].includes(raw)
      )
        return raw;
      if (raw === 0) return 'None';
      if (raw === 1) return 'Normal';
      if (raw === 3) return 'Old';
      if (raw === 4) return 'Young';
      return undefined;
    },
    ['Age'],
    true,
  );
  let canonicalRace: Race | null = null;
  let raceSource: 'tribe' | 'race' | null = null;
  if (tribe.state === 'valid') {
    canonicalRace = RACES[Math.floor(TRIBES.indexOf(tribe.value) / 2)] ?? null;
    raceSource = 'tribe';
    if (race.state === 'valid' && race.value !== canonicalRace)
      reader.issues.add(
        'RACE_TRIBE_MISMATCH',
        ['Race'],
        'Declared race differs from the supported tribe mapping.',
      );
  } else if (
    (tribe.state === 'absent' || tribe.state === 'null') &&
    race.state === 'valid'
  ) {
    canonicalRace = race.value;
    raceSource = 'race';
  }
  const metadata = Object.create(null) as CharaInspection['metadata'];
  for (const key of METADATA_FIELDS) {
    metadata[key] = reader.field(fields, key, (raw) =>
      typeof raw === 'string' ||
      (['SaveMode', 'FileVersion', 'Version', 'ObjectKind'].includes(key) &&
        isUint(raw, 0xffffffff))
        ? raw
        : undefined,
    );
  }
  const appearance = Object.create(null) as CharaInspection['appearance'];
  for (const key of BYTE_FIELDS)
    appearance[key] = reader.integer(fields, key, 255);
  appearance.EnableHighlights = reader.field(
    fields,
    'EnableHighlights',
    (raw) => (typeof raw === 'boolean' ? raw : undefined),
  );
  appearance.FacialFeatures = reader.field(
    fields,
    'FacialFeatures',
    (raw) => {
      if (isUint(raw, 255)) return raw;
      if (raw === 'None') return 0;
      if (typeof raw !== 'string') return undefined;
      const parts = raw.split(',').map((value) => value.trim());
      if (
        parts.length > 8 ||
        parts.some((value) => !FLAG_NAMES.includes(value))
      )
        return undefined;
      return parts.reduce(
        (value, name) => value | (2 ** FLAG_NAMES.indexOf(name)),
        0,
      );
    },
    ['FacialFeatures'],
    true,
  );
  const extended = Object.create(null) as CharaInspection['extended'];
  for (const key of COLOR_FIELDS)
    extended[key] = reader.field(fields, key, (raw) =>
      vector(raw, key === 'MouthColor' ? 4 : 3),
    );
  extended.BustScale = reader.field(fields, 'BustScale', (raw) =>
    vector(raw, 3),
  );
  for (const key of FLOAT_FIELDS)
    extended[key] = reader.field(fields, key, (raw) =>
      finite(raw) ? raw : undefined,
    );
  extended.IsExtendedAppearanceValid = reader.field(
    fields,
    'IsExtendedAppearanceValid',
    (raw) => (typeof raw === 'boolean' ? raw : undefined),
  );
  const equipment = Object.create(null) as CharaInspection['equipment'];
  for (const slot of EQUIPMENT_SLOTS) equipment[slot] = reader.equipment(slot);
  const facewear = reader.field(fields, 'Glasses', (raw) => {
    if (isUint(raw)) return raw;
    if (
      isRecord(raw) &&
      Object.hasOwn(raw, 'GlassesId') &&
      isUint(raw.GlassesId)
    )
      return raw.GlassesId;
    return undefined;
  });
  const modelType = reader.integer(fields, 'ModelType', 0xffffffff);
  if (readerTruncated) reader.issues.markTruncated();
  return {
    document,
    metadata,
    identity: {
      race,
      tribe,
      gender,
      age,
      modelType,
      canonicalRace,
      raceSource,
    },
    appearance,
    extended,
    equipment,
    facewear,
    issues: reader.issues.issues,
  };
}
