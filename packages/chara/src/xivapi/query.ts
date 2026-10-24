import { modelKey } from '../models.js';
import { isAbortSignalLike } from '../realm.js';
import type { EquipmentModel, EquipmentSlot } from '../types.js';
import type { Language } from './types.js';

/** The caller's signal from request options, validated before any job is created. */
export function signalFrom(requestOptions: unknown): AbortSignal | undefined {
  if (
    typeof requestOptions !== 'object' ||
    requestOptions === null ||
    Array.isArray(requestOptions)
  )
    throw new XivapiInputError('INVALID_LOOKUP');
  // A getter that throws, or an AbortSignal-shaped object that fails its brand check when read,
  // is as invalid as any other non-signal.
  try {
    const signal = (requestOptions as { signal?: unknown }).signal;
    if (signal === undefined) return undefined;
    if (isAbortSignalLike(signal)) return signal;
  } catch {
    // fall through
  }
  throw new XivapiInputError('INVALID_LOOKUP');
}

export class XivapiInputError extends Error {
  constructor(readonly code: 'INVALID_OPTIONS' | 'INVALID_LOOKUP') {
    super(
      code === 'INVALID_OPTIONS'
        ? 'Invalid XIVAPI options.'
        : 'Invalid equipment lookup.',
    );
    this.name = 'XivapiInputError';
  }
}
export const SLOT_COLUMNS = Object.freeze({
  MainHand: 'MainHand',
  OffHand: 'OffHand',
  HeadGear: 'Head',
  Body: 'Body',
  Hands: 'Gloves',
  Legs: 'Legs',
  Feet: 'Feet',
  Ears: 'Ears',
  Neck: 'Neck',
  Wrists: 'Wrists',
  LeftRing: 'FingerL',
  RightRing: 'FingerR',
} satisfies Record<EquipmentSlot, string>);
export const LANGUAGES: readonly Language[] = Object.freeze([
  'en',
  'ja',
  'de',
  'fr',
]);
export const WEAR_COLUMNS = Object.freeze([
  'Hyur',
  'Elezen',
  'Lalafell',
  'Miqote',
  'Roegadyn',
  'AuRa',
  'Hrothgar',
  'Viera',
  'Male',
  'Female',
]);
export const canonicalVersion = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{16}$/.test(v);
export const canonicalSchema = (s: unknown): s is string =>
  typeof s === 'string' && /^exdschema@2:rev:[a-f0-9]{40}$/.test(s);
export interface SlotLookup {
  slot: EquipmentSlot;
  key: string;
}
export interface StainLookup {
  stains: readonly number[];
}
export type LookupSelection = readonly SlotLookup[] | number | StainLookup;
export const isStainLookup = (
  selection: LookupSelection,
): selection is StainLookup =>
  typeof selection === 'object' && 'stains' in selection;

export function stainsFrom(ids: readonly number[]): number[] {
  if (!Array.isArray(ids) || ids.length > 64)
    throw new XivapiInputError('INVALID_LOOKUP');
  const selected: number[] = [];
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > 65535)
      throw new XivapiInputError('INVALID_LOOKUP');
    selected.push(id);
  }
  return [...new Set(selected)].sort((a, b) => a - b);
}
export function lookupsFrom(models: readonly EquipmentModel[]): SlotLookup[] {
  if (!Array.isArray(models) || models.length > 24)
    throw new XivapiInputError('INVALID_LOOKUP');
  const seen = new Map<EquipmentSlot, string>();
  for (const model of models) {
    let key: string;
    try {
      key = modelKey(model);
    } catch {
      throw new XivapiInputError('INVALID_LOOKUP');
    }
    if (seen.has(model.slot) && seen.get(model.slot) !== key)
      throw new XivapiInputError('INVALID_LOOKUP');
    seen.set(model.slot, key);
  }
  return [...seen]
    .map(([slot, key]) => ({ slot, key }))
    .sort((a, b) => a.slot.localeCompare(b.slot));
}
export function buildQuery(lookups: readonly SlotLookup[]): string {
  return `+(${lookups.map((l) => `(+EquipSlotCategory.${SLOT_COLUMNS[l.slot]}=1 +ModelMain=${l.key})`).join(' ')})`;
}
export function fieldsFor(
  languages: readonly Language[],
  items: boolean,
): string {
  const common = [...languages.map((l) => `Name@lang(${l})`), 'Icon.id'];
  return (
    items
      ? [
          ...common,
          'ModelMain',
          'ModelSub',
          'LevelEquip',
          'ItemUICategory.row_id',
          ...Object.values(SLOT_COLUMNS).map((c) => `EquipSlotCategory.${c}`),
          'DyeCount',
          'IsGlamorous',
          ...WEAR_COLUMNS.map((c) => `EquipRestriction.${c}`),
          'GrandCompany.row_id',
        ]
      : common
  ).join(',');
}
