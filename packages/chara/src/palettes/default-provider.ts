import { isRecord } from '../field-spec.js';
import {
  type DatasetKey,
  type PaletteDataset,
  type RaceDataset,
  SHADER_SHARED,
  SHARED_LENGTHS,
  type SharedDataset,
  TRIBES,
} from './layout.js';
import metadata from './metadata.json' with { type: 'json' };
import type {
  PaletteColor,
  PaletteMetadata,
  PaletteProvider,
  PaletteRequest,
} from './types.js';

export class PaletteDataError extends Error {
  readonly code = 'PALETTE_LOAD_FAILED';
  constructor() {
    super('Palette data could not be loaded.');
    this.name = 'PaletteDataError';
  }
}
function freeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
freeze(metadata);
export const PALETTE_METADATA: PaletteMetadata = metadata;
const own = (record: object, key: PropertyKey) => Object.hasOwn(record, key);

function colors(value: unknown, length: number): readonly string[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new PaletteDataError();
  // Every index is read: Array.prototype.some and every skip the holes of a sparse array.
  const result: string[] = [];
  for (let i = 0; i < length; i++) {
    const hex: unknown = value[i];
    if (typeof hex !== 'string' || !/^#[0-9A-F]{6}$/.test(hex))
      throw new PaletteDataError();
    result.push(hex);
  }
  return Object.freeze(result);
}
function validate(data: unknown, key: DatasetKey): PaletteDataset {
  if (!isRecord(data)) throw new PaletteDataError();
  if (key.endsWith('shared')) {
    const result: SharedDataset = Object.create(null);
    const names =
      key === 'creator-shared' ? Object.keys(SHARED_LENGTHS) : SHADER_SHARED;
    for (const name of names) {
      if (!own(data, name)) throw new PaletteDataError();
      result[name] = colors(
        data[name],
        SHARED_LENGTHS[name as keyof typeof SHARED_LENGTHS],
      );
    }
    return result;
  }
  const result: RaceDataset = Object.create(null);
  for (const name of ['skin', 'hair']) {
    const palette = own(data, name) ? data[name] : undefined;
    if (!isRecord(palette)) throw new PaletteDataError();
    const tribes: RaceDataset[string] = Object.create(null);
    for (const tribe of TRIBES) {
      const entry = own(palette, tribe) ? palette[tribe] : undefined;
      if (!isRecord(entry) || !own(entry, 'Male') || !own(entry, 'Female'))
        throw new PaletteDataError();
      tribes[tribe] = {
        Male: colors(entry.Male, 192),
        Female: colors(entry.Female, 192),
      };
    }
    result[name] = tribes;
  }
  return result;
}

export type PaletteLoaders = Partial<
  Record<DatasetKey, () => Promise<unknown>>
>;
/** Shared lazy loader used by the bundled provider. Host loaders are trusted JavaScript. */
export function createLazyPaletteProvider(
  loaders: PaletteLoaders,
): PaletteProvider & { readonly metadata: PaletteMetadata } {
  const pending = new Map<DatasetKey, Promise<PaletteDataset>>();
  async function load(key: DatasetKey): Promise<PaletteDataset> {
    let task = pending.get(key);
    if (!task) {
      task = Promise.resolve()
        .then(() => {
          const loader = loaders[key];
          if (!loader) throw new PaletteDataError();
          return loader();
        })
        .then((data) => validate(data, key))
        .catch(() => {
          pending.delete(key);
          throw new PaletteDataError();
        });
      pending.set(key, task);
    }
    return task;
  }
  return {
    metadata: PALETTE_METADATA,
    async getColor(request: PaletteRequest): Promise<PaletteColor | null> {
      if (!isRecord(request)) return null;
      // Capture scalar coordinates before any asynchronous load or caller reuse.
      const { table, palette: name, index, tribe, gender } = request;
      if (
        (table !== 'creator' && table !== 'shader') ||
        typeof name !== 'string' ||
        !Number.isInteger(index) ||
        index < 0
      )
        return null;
      const race = name === 'skin' || name === 'hair';
      if (
        !race &&
        (!own(SHARED_LENGTHS, name) ||
          index >= SHARED_LENGTHS[name as keyof typeof SHARED_LENGTHS])
      )
        return null;
      if (
        table === 'shader' &&
        !race &&
        !(SHADER_SHARED as readonly unknown[]).includes(name)
      )
        return null;
      if (
        race &&
        (index >= 192 ||
          !(TRIBES as readonly unknown[]).includes(tribe) ||
          (gender !== 'Masculine' && gender !== 'Feminine'))
      )
        return null;
      const data = await load(`${table}-${race ? 'race' : 'shared'}`);
      const palette = data[name];
      const hex = race
        ? (palette as RaceDataset[string])[tribe as string]?.[
            gender === 'Masculine' ? 'Male' : 'Female'
          ]?.[index]
        : (palette as readonly string[])[index];
      if (!hex) return null;
      return {
        table,
        palette: name,
        index,
        ...(race ? { tribe, gender } : {}),
        hex,
        rgb: [
          Number.parseInt(hex.slice(1, 3), 16),
          Number.parseInt(hex.slice(3, 5), 16),
          Number.parseInt(hex.slice(5, 7), 16),
        ],
        datasetVersion: PALETTE_METADATA.datasetVersion,
      };
    },
  };
}
