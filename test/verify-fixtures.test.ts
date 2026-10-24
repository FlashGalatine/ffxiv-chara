import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyFixtures } from '../scripts/fixtures-check.js';

const real = fileURLToPath(new URL('../fixtures/', import.meta.url));
const realExamples = fileURLToPath(
  new URL('../apps/demo/public/examples/', import.meta.url),
);
const temp = mkdtempSync(join(tmpdir(), 'verify-fixtures-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let fixtures = '';
let examples = '';
let n = 0;
beforeEach(() => {
  const dir = join(temp, String(++n));
  fixtures = join(dir, 'fixtures');
  examples = join(dir, 'examples');
  cpSync(real, fixtures, { recursive: true });
  cpSync(realExamples, examples, { recursive: true });
});
const run = () =>
  verifyFixtures({
    fixturesRoot: pathToFileURL(`${fixtures}/`),
    examplesRoot: pathToFileURL(`${examples}/`),
  });
const editManifest = (change: (manifest: Record<string, unknown>) => void) => {
  const file = join(fixtures, 'manifest.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  change(manifest);
  writeFileSync(file, JSON.stringify(manifest));
};

describe('fixture verification', () => {
  it('accepts the committed fixtures and reports what it checked', async () => {
    expect(await run()).toMatchObject({
      fixtures: 9,
      examples: 3,
      equipmentRows: true,
      appearanceExpectations: true,
    });
  });
  it('fails when the manifest lists no fixtures instead of verifying zero', async () => {
    editManifest((m) => {
      m.fixtures = [];
    });
    await expect(run()).rejects.toThrow(/no character fixtures/);
  });
  it('fails for a .chara file the manifest does not list', async () => {
    writeFileSync(join(fixtures, 'partial', 'unlisted.chara'), '{"Hair":1}');
    await expect(run()).rejects.toThrow(/unlisted/i);
  });
  it('fails for an unlisted file whose extension is in another case', async () => {
    writeFileSync(join(fixtures, 'brio', 'Export.CHARA'), '{"Hair":1}');
    await expect(run()).rejects.toThrow(/Export.CHARA/);
  });
  it('fails for a link under fixtures, which could hide .chara files from the check', async () => {
    const outside = join(temp, `outside-${n}`);
    mkdirSync(outside);
    writeFileSync(join(outside, 'hidden.chara'), '{"Hair":1}');
    // A directory junction (a plain symlink on Linux).
    symlinkSync(outside, join(fixtures, 'linked'), 'junction');
    await expect(run()).rejects.toThrow(/link/i);
  });
  it('fails for a listed fixture that is missing', async () => {
    rmSync(join(fixtures, 'partial', 'equipment.chara'));
    await expect(run()).rejects.toThrow();
  });
  it('fails when a fixture is changed', async () => {
    appendFileSync(join(fixtures, 'partial', 'equipment.chara'), ' ');
    await expect(run()).rejects.toThrow(/hash/i);
  });
  it('fails when the appearance expectations are changed or not pinned', async () => {
    appendFileSync(join(fixtures, 'expected', 'appearance.json'), ' ');
    await expect(run()).rejects.toThrow(/appearance/i);
  });
  it('fails when the manifest does not pin the appearance expectations', async () => {
    editManifest((m) => {
      delete m.appearanceExpectations;
    });
    await expect(run()).rejects.toThrow(/appearance/i);
  });
  it('fails when the equipment rows are changed', async () => {
    appendFileSync(join(fixtures, 'expected', 'equipment-rows.json'), ' ');
    await expect(run()).rejects.toThrow();
  });
  it('fails when a public example differs from its reviewed fixture', async () => {
    appendFileSync(join(examples, 'ktisis.chara'), ' ');
    await expect(run()).rejects.toThrow(/example/i);
  });
  it('fails when a public example is missing', async () => {
    rmSync(join(examples, 'brio.chara'));
    await expect(run()).rejects.toThrow();
  });
});
