import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDefaultPaletteProvider,
  PALETTE_METADATA,
} from '../packages/chara/src/palettes/index.js';
import {
  assertArtifactSet,
  countColors,
  sha256,
  totalColors,
} from './palette-metadata.js';

const root = new URL('../packages/chara/src/palettes/', import.meta.url);
assertArtifactSet(PALETTE_METADATA.artifacts);
for (const artifact of PALETTE_METADATA.artifacts) {
  assert(/^data\/(creator|shader)-(shared|race)\.json$/.test(artifact.file));
  const data: unknown = JSON.parse(
    await readFile(new URL(artifact.file, root), 'utf8'),
  );
  assert.equal(sha256(JSON.stringify(data)), artifact.sha256);
  assert.equal(countColors(data), artifact.colorCount);
}
const provider = createDefaultPaletteProvider();
for (const table of ['creator', 'shader'] as const) {
  assert.equal(
    (await provider.getColor({ table, palette: 'eyes', index: 0 }))?.hex,
    '#F7F7F7',
  );
  for (const gender of ['Masculine', 'Feminine'] as const) {
    for (const palette of ['skin', 'hair'] as const)
      assert(
        await provider.getColor({
          table,
          palette,
          index: 191,
          tribe: 'Veena',
          gender,
        }),
      );
  }
}
assert.equal(
  (
    await provider.getColor({
      table: 'creator',
      palette: 'hair',
      index: 42,
      tribe: 'Raen',
      gender: 'Feminine',
    })
  )?.hex,
  '#FFDC98',
);
assert.equal(
  (
    await provider.getColor({
      table: 'shader',
      palette: 'hair',
      index: 42,
      tribe: 'Raen',
      gender: 'Feminine',
    })
  )?.hex,
  '#E5D2AC',
);
console.log(
  `Verified ${PALETTE_METADATA.artifacts.length} table hashes and ${totalColors(PALETTE_METADATA.artifacts).toLocaleString('en-US')} palette colors; dataset ${PALETTE_METADATA.datasetVersion}, game revision ${PALETTE_METADATA.gameVersion ?? 'unknown'}.`,
);
