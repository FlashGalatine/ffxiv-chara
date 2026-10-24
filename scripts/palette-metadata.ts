import { createHash } from 'node:crypto';
import type { PaletteMetadata } from '../packages/chara/src/palettes/types.js';
import type { PaletteTables } from './palette-generation.js';

/** The four generated tables, and the only artifact list a palette dataset may have. */
export const ARTIFACT_FILES = [
  'data/creator-race.json',
  'data/creator-shared.json',
  'data/shader-race.json',
  'data/shader-shared.json',
] as const;

export interface ArtifactInfo {
  file: string;
  sha256: string;
  colorCount: number;
}
/** What a human.cmp produces: its own hash and size, and the tables derived from it. */
export interface Derived {
  sourceSha256: string;
  sourceBytes: number;
  artifacts: readonly ArtifactInfo[];
}

export const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

export const countColors = (value: unknown): number =>
  Array.isArray(value)
    ? value.length
    : Object.values(value as object).reduce<number>(
        (total, child) => total + countColors(child),
        0,
      );

export const describeArtifacts = (tables: PaletteTables): ArtifactInfo[] =>
  Object.entries(tables).map(([name, value]) => ({
    file: `data/${name}.json`,
    sha256: sha256(JSON.stringify(value)),
    colorCount: countColors(value),
  }));

/**
 * The metadata a regeneration writes. `sources` lists the upstream JSON files the baseline tables
 * were repacked from; tables regenerated from another human.cmp no longer derive from them, so
 * they are dropped unless the caller says the inputs are unchanged. `source` stays: it is the
 * attribution of the adapted layout code and the field is not nullable.
 */
export function updatedMetadata(
  previous: PaletteMetadata,
  derived: Derived,
  options: {
    datasetVersion: string;
    gameVersion: string | null;
    keepSources: boolean;
  },
): PaletteMetadata {
  return {
    ...previous,
    datasetVersion: options.datasetVersion,
    gameVersion: options.gameVersion,
    generatedFrom: { sha256: derived.sourceSha256, bytes: derived.sourceBytes },
    sources: options.keepSources ? previous.sources.map((s) => ({ ...s })) : [],
    artifacts: derived.artifacts.map((a) => ({ ...a })),
  };
}

/** What would change if the tables were regenerated from this file; empty means nothing. */
export function metadataMismatches(
  metadata: PaletteMetadata,
  derived: Derived,
): string[] {
  const differences: string[] = [];
  if (!metadata.generatedFrom)
    differences.push('committed metadata records no source file');
  else {
    if (metadata.generatedFrom.sha256 !== derived.sourceSha256)
      differences.push('source sha256 differs');
    if (metadata.generatedFrom.bytes !== derived.sourceBytes)
      differences.push('source byte length differs');
  }
  const committed = new Map(metadata.artifacts.map((a) => [a.file, a]));
  const produced = new Set<string>();
  for (const artifact of derived.artifacts) {
    produced.add(artifact.file);
    const known = committed.get(artifact.file);
    if (!known) {
      differences.push(`${artifact.file}: not in the committed metadata`);
      continue;
    }
    if (known.sha256 !== artifact.sha256)
      differences.push(`${artifact.file}: sha256 differs`);
    if (known.colorCount !== artifact.colorCount)
      differences.push(`${artifact.file}: colour count differs`);
  }
  for (const file of committed.keys())
    if (!produced.has(file)) differences.push(`${file}: not produced`);
  return differences;
}

/** The dataset must list exactly the four tables, each once. */
export function assertArtifactSet(artifacts: readonly ArtifactInfo[]): void {
  const files = artifacts.map((a) => a.file).sort();
  const expected = [...ARTIFACT_FILES].sort();
  if (
    files.length !== expected.length ||
    files.some((f, i) => f !== expected[i])
  )
    throw new Error(
      `Palette metadata must list exactly: ${ARTIFACT_FILES.join(', ')}.`,
    );
}

export const totalColors = (artifacts: readonly ArtifactInfo[]): number =>
  artifacts.reduce((total, a) => total + a.colorCount, 0);
