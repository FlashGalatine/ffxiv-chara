import { open, readFile, writeFile } from 'node:fs/promises';
import type { PaletteMetadata } from '../packages/chara/src/palettes/types.js';
import {
  CMP_MAX_BYTES,
  CMP_MIN_BYTES,
  generatePaletteTables,
} from './palette-generation.js';
import {
  type Derived,
  describeArtifacts,
  metadataMismatches,
  sha256,
  updatedMetadata,
} from './palette-metadata.js';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const path = args[0];
const check = args.includes('--check');
const keepSources = args.includes('--keep-sources');
const datasetVersion = args[args.indexOf('--dataset-version') + 1];
const gameVersion = args.includes('--game-version')
  ? args[args.indexOf('--game-version') + 1]
  : null;
if (
  !path ||
  path.startsWith('--') ||
  (!check &&
    (!args.includes('--dataset-version') ||
      !datasetVersion ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(datasetVersion))) ||
  (gameVersion !== null &&
    (!gameVersion || !/^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(gameVersion)))
)
  throw new Error(
    'Usage: build-palettes.ts <explicit-local-human.cmp> --check | --dataset-version <version> [--game-version <revision>] [--keep-sources]',
  );
const file = await open(path, 'r');
let bytes: Buffer;
try {
  const stat = await file.stat();
  // Checked before any byte is read, with a message of its own: the generator rejects a bad layout
  // with another one, so a test can tell which of the two gates refused the file.
  if (
    !stat.isFile() ||
    stat.size < CMP_MIN_BYTES ||
    stat.size > CMP_MAX_BYTES ||
    stat.size % 4 !== 0
  )
    throw new Error(
      `Source file must be a regular file whose size is a multiple of 4 between ${CMP_MIN_BYTES} and ${CMP_MAX_BYTES} bytes.`,
    );
  // Read only the admitted layout; a concurrently growing file cannot expand this allocation.
  bytes = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < bytes.length) {
    const result = await file.read(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (result.bytesRead === 0)
      throw new Error('Source file changed during reading.');
    offset += result.bytesRead;
  }
} finally {
  await file.close();
}
const tables = generatePaletteTables(bytes);
const artifacts = describeArtifacts(tables);
const derived: Derived = {
  sourceSha256: sha256(bytes),
  sourceBytes: bytes.length,
  artifacts,
};
const root = new URL('../packages/chara/src/palettes/', import.meta.url);
const metadata = JSON.parse(
  await readFile(new URL('metadata.json', root), 'utf8'),
) as PaletteMetadata;
const differences = check ? metadataMismatches(metadata, derived) : [];
if (!check) {
  const updated = updatedMetadata(metadata, derived, {
    datasetVersion: datasetVersion as string,
    gameVersion,
    keepSources,
  });
  for (const [name, value] of Object.entries(tables))
    await writeFile(
      new URL(`data/${name}.json`, root),
      `${JSON.stringify(value)}\n`,
    );
  await writeFile(
    new URL('metadata.json', root),
    `${JSON.stringify(updated, null, 2)}\n`,
  );
}
console.log(
  JSON.stringify(
    {
      mode: check ? 'check' : 'write',
      sourceSha256: derived.sourceSha256,
      sourceBytes: derived.sourceBytes,
      artifacts,
      ...(check
        ? { matchesCommitted: differences.length === 0, differences }
        : { sourcesKept: keepSources }),
    },
    null,
    2,
  ),
);
// --check is a gate: a file that would change the committed palettes is a failure.
if (differences.length > 0) process.exitCode = 1;
