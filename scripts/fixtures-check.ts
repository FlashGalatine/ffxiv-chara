import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { inspectChara, readChara } from '../packages/chara/src/index.js';

interface Manifest {
  equipmentRows: { path: string; sha256: string };
  appearanceExpectations?: { path: string; sha256: string };
  fixtures: {
    path: string;
    sha256: string;
    expected: { canonicalRace: string | null; facewear: number | null };
  }[];
}
/** The public demo examples and the reviewed synthetic fixtures they must copy byte for byte. */
const EXAMPLES: readonly (readonly [string, string])[] = [
  ['anamnesis.chara', 'anamnesis/full.chara'],
  ['ktisis.chara', 'ktisis/full.chara'],
  ['brio.chara', 'brio/extended.chara'],
];
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

async function charaFiles(root: URL, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(new URL(prefix, root), {
    withFileTypes: true,
  })) {
    const path = `${prefix}${entry.name}`;
    // A link could point at .chara files outside this tree, which would never be listed or hashed.
    if (entry.isSymbolicLink())
      throw new Error(`Fixtures must not be reached through a link: ${path}.`);
    if (entry.isDirectory())
      found.push(...(await charaFiles(root, `${path}/`)));
    else if (/\.chara$/i.test(entry.name)) found.push(path);
  }
  return found;
}

export interface FixtureReport {
  fixtures: number;
  examples: number;
  equipmentRows: boolean;
  appearanceExpectations: boolean;
}

/** Throws unless every fixture is listed, unchanged and reads as the manifest says. */
export async function verifyFixtures(roots: {
  fixturesRoot: URL;
  examplesRoot: URL;
}): Promise<FixtureReport> {
  const root = roots.fixturesRoot;
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', root), 'utf8'),
  ) as Manifest;
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0)
    throw new Error('The manifest lists no character fixtures.');
  const listed = new Set(manifest.fixtures.map((entry) => entry.path));
  const unlisted = (await charaFiles(root)).filter((p) => !listed.has(p));
  if (unlisted.length > 0)
    throw new Error(
      `Character fixtures not listed in the manifest: ${unlisted.join(', ')}.`,
    );
  for (const entry of manifest.fixtures) {
    const bytes = await readFile(new URL(entry.path, root));
    if (sha256(bytes) !== entry.sha256)
      throw new Error('Fixture hash mismatch.');
    const result = inspectChara(readChara(bytes));
    if (
      result.identity.canonicalRace !== entry.expected.canonicalRace ||
      (result.facewear.value ?? null) !== entry.expected.facewear
    )
      throw new Error('Fixture expectation mismatch.');
  }
  const rows = await readFile(new URL(manifest.equipmentRows.path, root));
  if (sha256(rows) !== manifest.equipmentRows.sha256)
    throw new Error('Equipment fixture hash mismatch.');
  const pinned = manifest.appearanceExpectations;
  if (!pinned)
    throw new Error('The manifest does not pin the appearance expectations.');
  const appearance = await readFile(new URL(pinned.path, root));
  if (sha256(appearance) !== pinned.sha256)
    throw new Error('Appearance expectations hash mismatch.');
  for (const [example, source] of EXAMPLES) {
    const [exampleBytes, sourceBytes] = await Promise.all([
      readFile(new URL(example, roots.examplesRoot)),
      readFile(new URL(source, root)),
    ]);
    if (!exampleBytes.equals(sourceBytes))
      throw new Error(
        'Public example differs from reviewed synthetic fixture.',
      );
  }
  return {
    fixtures: manifest.fixtures.length,
    examples: EXAMPLES.length,
    equipmentRows: true,
    appearanceExpectations: true,
  };
}
