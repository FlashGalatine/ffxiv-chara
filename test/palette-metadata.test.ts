import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PALETTE_METADATA } from '../packages/chara/src/palettes/index.js';
import {
  assertArtifactSet,
  type Derived,
  metadataMismatches,
  totalColors,
  updatedMetadata,
} from '../scripts/palette-metadata.js';

const committed = (): Derived => {
  if (!PALETTE_METADATA.generatedFrom)
    throw new Error('Expected a recorded source.');
  return {
    sourceSha256: PALETTE_METADATA.generatedFrom.sha256,
    sourceBytes: PALETTE_METADATA.generatedFrom.bytes,
    artifacts: PALETTE_METADATA.artifacts.map((a) => ({ ...a })),
  };
};
const changed = (): Derived => ({
  sourceSha256: 'b'.repeat(64),
  sourceBytes: 190_000,
  artifacts: PALETTE_METADATA.artifacts.map((a) => ({
    ...a,
    sha256: 'c'.repeat(64),
    colorCount: a.colorCount + 1,
  })),
});

describe('metadata written by a regeneration', () => {
  it('replaces the dataset, game version, source and artifacts', () => {
    const next = updatedMetadata(PALETTE_METADATA, changed(), {
      datasetVersion: '2026-12-01-patch-8',
      gameVersion: '8.0',
      keepSources: false,
    });
    expect(next).toMatchObject({
      datasetVersion: '2026-12-01-patch-8',
      gameVersion: '8.0',
      generatedFrom: { sha256: 'b'.repeat(64), bytes: 190_000 },
    });
    expect(next.artifacts.map((a) => a.sha256)).toEqual(
      changed().artifacts.map((a) => a.sha256),
    );
  });
  it('drops the upstream source hashes, since the new tables no longer derive from them', () => {
    expect(PALETTE_METADATA.sources.length).toBeGreaterThan(0);
    const next = updatedMetadata(PALETTE_METADATA, changed(), {
      datasetVersion: 'x',
      gameVersion: null,
      keepSources: false,
    });
    expect(next.sources).toEqual([]);
    // The attribution of the adapted layout code stays: the field is not nullable.
    expect(next.source).toEqual(PALETTE_METADATA.source);
    expect(next.gameVersion).toBeNull();
  });
  it('keeps them only when asked, for a rewrite from the same inputs', () => {
    const next = updatedMetadata(PALETTE_METADATA, committed(), {
      datasetVersion: PALETTE_METADATA.datasetVersion,
      gameVersion: PALETTE_METADATA.gameVersion,
      keepSources: true,
    });
    expect(next).toEqual(JSON.parse(JSON.stringify(PALETTE_METADATA)));
  });
  it('does not change the metadata it was given', () => {
    const before = JSON.stringify(PALETTE_METADATA);
    updatedMetadata(PALETTE_METADATA, changed(), {
      datasetVersion: 'x',
      gameVersion: null,
      keepSources: false,
    });
    expect(JSON.stringify(PALETTE_METADATA)).toBe(before);
  });
});

describe('check mode comparison', () => {
  it('finds no difference for the committed values', () => {
    expect(metadataMismatches(PALETTE_METADATA, committed())).toEqual([]);
  });
  it('reports a different source file', () => {
    const differences = metadataMismatches(PALETTE_METADATA, {
      ...committed(),
      sourceSha256: 'b'.repeat(64),
    });
    expect(differences).toEqual(['source sha256 differs']);
    expect(
      metadataMismatches(PALETTE_METADATA, { ...committed(), sourceBytes: 1 }),
    ).toEqual(['source byte length differs']);
  });
  it('reports every changed artifact hash and colour count', () => {
    const differences = metadataMismatches(PALETTE_METADATA, changed());
    expect(differences.filter((d) => d.startsWith('data/'))).toHaveLength(
      PALETTE_METADATA.artifacts.length * 2,
    );
    expect(differences).toContain('data/creator-shared.json: sha256 differs');
    expect(differences).toContain(
      'data/shader-race.json: colour count differs',
    );
  });
  it('reports a missing and an unexpected artifact', () => {
    const base = committed();
    const artifacts = [...base.artifacts];
    const dropped = artifacts.shift();
    artifacts.push({
      file: 'data/extra.json',
      sha256: 'd'.repeat(64),
      colorCount: 1,
    });
    expect(
      metadataMismatches(PALETTE_METADATA, { ...base, artifacts }),
    ).toEqual(
      expect.arrayContaining([
        `${dropped?.file}: not produced`,
        'data/extra.json: not in the committed metadata',
      ]),
    );
  });
  it('reports metadata that records no source file', () => {
    expect(
      metadataMismatches(
        { ...PALETTE_METADATA, generatedFrom: null },
        committed(),
      ),
    ).toEqual(['committed metadata records no source file']);
  });
});

describe('the committed artifact list', () => {
  it('is exactly the four tables and totals 26,208 colours', () => {
    expect(() => assertArtifactSet(PALETTE_METADATA.artifacts)).not.toThrow();
    expect(totalColors(PALETTE_METADATA.artifacts)).toBe(26_208);
  });
  it('rejects a list that lost a table, repeats one or names another file', () => {
    const [first, ...rest] = PALETTE_METADATA.artifacts;
    if (!first) throw new Error('Expected artifacts.');
    expect(() => assertArtifactSet(rest)).toThrow();
    expect(() => assertArtifactSet([first])).toThrow();
    expect(() => assertArtifactSet([...rest, first, first])).toThrow();
    expect(() =>
      assertArtifactSet([
        ...rest,
        { ...first, file: 'data/creator-unknown.json' },
      ]),
    ).toThrow();
    expect(() => assertArtifactSet([])).toThrow();
  });
});

// The scripts write to fixed paths relative to their own location, so they run here from a replica
// of the layout: a regression that writes in check mode, or at all, can never touch the repository.
const repo = fileURLToPath(new URL('../', import.meta.url));
const tsx = join(repo, 'node_modules/tsx/dist/cli.mjs');
const temp = mkdtempSync(join(tmpdir(), 'palette-scripts-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let counter = 0;
const replica = () => {
  const dir = join(temp, String(++counter));
  mkdirSync(join(dir, 'packages/chara'), { recursive: true });
  cpSync(join(repo, 'scripts'), join(dir, 'scripts'), { recursive: true });
  cpSync(join(repo, 'packages/chara/src'), join(dir, 'packages/chara/src'), {
    recursive: true,
  });
  for (const file of ['package.json', 'packages/chara/package.json'])
    cpSync(join(repo, file), join(dir, file));
  return dir;
};
const palettesOf = (dir: string) => join(dir, 'packages/chara/src/palettes');
const digest = (dir: string): string => {
  const hash = createHash('sha256');
  const files = [
    'metadata.json',
    ...readdirSync(join(palettesOf(dir), 'data')).map((f) => `data/${f}`),
  ];
  for (const file of files.sort())
    hash.update(file).update(readFileSync(join(palettesOf(dir), file)));
  return hash.digest('hex');
};
const run = (dir: string, script: string, args: string[]) =>
  spawnSync(process.execPath, [tsx, join(dir, 'scripts', script), ...args], {
    encoding: 'utf8',
    timeout: 60_000,
  });
const zeroCmp = (): string => {
  const file = join(temp, `zero-${++counter}.cmp`);
  writeFileSync(file, Buffer.alloc(182_272));
  return file;
};

describe('build-palettes --check, run as a script', () => {
  it('fails for a file that would change the committed palettes, and writes nothing', () => {
    const dir = replica();
    const before = digest(dir);
    const result = run(dir, 'build-palettes.ts', [zeroCmp(), '--check']);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ mode: 'check', matchesCommitted: false });
    expect(report.differences.length).toBeGreaterThan(0);
    expect(digest(dir)).toBe(before);
  });
});

describe('build-palettes write mode, run as a script', () => {
  const metadata = (dir: string) =>
    JSON.parse(readFileSync(join(palettesOf(dir), 'metadata.json'), 'utf8'));
  it('empties the upstream source hashes unless asked to keep them', () => {
    const dir = replica();
    const committedSources = metadata(dir).sources.length;
    expect(committedSources).toBeGreaterThan(0);
    const result = run(dir, 'build-palettes.ts', [
      zeroCmp(),
      '--dataset-version',
      'test-regeneration',
      '--game-version',
      '8.0',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(metadata(dir)).toMatchObject({
      datasetVersion: 'test-regeneration',
      gameVersion: '8.0',
      sources: [],
      generatedFrom: { bytes: 182_272 },
    });
  });
  it('keeps them with --keep-sources', () => {
    const dir = replica();
    const committedSources = metadata(dir).sources.length;
    const result = run(dir, 'build-palettes.ts', [
      zeroCmp(),
      '--dataset-version',
      'test-regeneration',
      '--keep-sources',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(metadata(dir).sources).toHaveLength(committedSources);
  });
});

describe('verify-palettes, run as a script', () => {
  it('passes for the committed dataset', () => {
    const result = run(replica(), 'verify-palettes.ts', []);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      'Verified 4 table hashes and 26,208 palette colors',
    );
  });
  it('fails when the metadata lost one of the four tables', () => {
    const dir = replica();
    const file = join(palettesOf(dir), 'metadata.json');
    const metadata = JSON.parse(readFileSync(file, 'utf8'));
    metadata.artifacts.pop();
    writeFileSync(file, JSON.stringify(metadata));
    const result = run(dir, 'verify-palettes.ts', []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must list exactly');
  });
});
