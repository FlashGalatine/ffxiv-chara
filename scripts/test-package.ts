import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicArtifact } from './package-policy.js';
import { getPackageArtifactName } from './release.js';
import { runTool } from './run-tool.js';
import { runRuntimeChecks } from './runtime-runner.js';

const root = new URL('../', import.meta.url);
const scratch = new URL('.superpowers/package-smoke/', root);
const committedMetadata = JSON.parse(
  await readFile(new URL('packages/chara/package.json', root), 'utf8'),
);
const tarball = fileURLToPath(
  new URL(getPackageArtifactName(committedMetadata), scratch),
);
const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/);
assert(entries.length > 2);
for (const entry of entries) {
  assert(
    /^package\/(?:package\.json|README\.md|dist\/(?:LICENSE|THIRD_PARTY_NOTICES\.md|(?:[a-z-]+\/)*[a-zA-Z0-9_-]+\.(?:js|d\.ts)))$/.test(
      entry,
    ),
    'Unexpected package file.',
  );
}
const consumer = await mkdtemp(join(tmpdir(), 'xivcharakit-consumer-'));
try {
  const installed = `${consumer}/node_modules/xivcharakit`;
  await mkdir(installed, { recursive: true });
  execFileSync('tar', [
    '-xzf',
    tarball,
    '-C',
    installed,
    '--strip-components=1',
  ]);
  for (const entry of entries) {
    const content = await readFile(
      join(installed, entry.slice('package/'.length)),
      'utf8',
    );
    assertPublicArtifact(entry, content);
    if (entry.endsWith('.js'))
      assert(
        !content.includes('namesSha256'),
        'Legacy dye-name snapshot entered the package.',
      );
  }
  async function checkDemo(directory: URL, prefix = ''): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      assert(!entry.isSymbolicLink(), 'Unexpected artifact symlink.');
      if (entry.isDirectory())
        await checkDemo(new URL(`${entry.name}/`, directory), `${path}/`);
      else {
        assert(
          /^(?:index\.html|_headers|LICENSE\.txt|THIRD_PARTY_NOTICES\.txt|assets\/[a-zA-Z0-9_-]+\.(?:js|css)|examples\/(?:anamnesis|ktisis|brio)\.chara|examples\/manifest\.json)$/.test(
            path,
          ),
          'Unexpected demo artifact.',
        );
        assertPublicArtifact(
          `apps/demo/dist/${path}`,
          await readFile(new URL(entry.name, directory), 'utf8'),
        );
        if (path.endsWith('.js'))
          assert(
            !(await readFile(new URL(entry.name, directory), 'utf8')).includes(
              'namesSha256',
            ),
            'Legacy dye-name snapshot entered the demo.',
          );
      }
    }
  }
  await checkDemo(new URL('apps/demo/dist/', root));
  const metadata = JSON.parse(
    await readFile(`${installed}/package.json`, 'utf8'),
  );
  assert.equal(metadata.type, 'module');
  assert.equal(metadata.name, 'xivcharakit');
  assert.equal(metadata.license, 'MIT');
  assert.equal(metadata.version, committedMetadata.version);
  assert.deepEqual(metadata.publishConfig, committedMetadata.publishConfig);
  assert.equal(
    await readFile(`${installed}/README.md`, 'utf8'),
    await readFile(new URL('packages/chara/README.md', root), 'utf8'),
    'Installed package must include the reviewed package README.',
  );
  assert.equal(
    await readFile(`${installed}/dist/THIRD_PARTY_NOTICES.md`, 'utf8'),
    await readFile(new URL('THIRD_PARTY_NOTICES.md', root), 'utf8'),
  );
  assert.equal(
    await readFile(`${installed}/dist/LICENSE`, 'utf8'),
    await readFile(new URL('LICENSE', root), 'utf8'),
    'Installed package must include the complete project license.',
  );
  for (const [source, output] of [
    ['LICENSE', 'LICENSE.txt'],
    ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt'],
  ] as const) {
    assert.equal(
      await readFile(new URL(`apps/demo/dist/${output}`, root), 'utf8'),
      await readFile(new URL(source, root), 'utf8'),
      'Demo must include the complete project license and notices.',
    );
  }
  assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
  await writeFile(
    `${consumer}/package.json`,
    '{"private":true,"type":"module"}',
  );
  await writeFile(
    `${consumer}/tsconfig.json`,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2022',
        module: 'NodeNext',
        types: [],
      },
      files: ['consumer.ts'],
    }),
  );
  await writeFile(
    `${consumer}/consumer.ts`,
    `import { readChara, inspectChara, modelKey, type CharaInspection } from 'xivcharakit';
const result: CharaInspection = inspectChara(readChara('{"HairTone":0}'));
const key: string = modelKey({ slot: 'MainHand', set: 634, base: 19, variant: 1 });
import { createDefaultPaletteProvider, type PaletteProvider } from 'xivcharakit/palettes';
const palettes: PaletteProvider = createDefaultPaletteProvider();
import { resolveAppearance, type AppearanceInspection } from 'xivcharakit/appearance';
const appearance: AppearanceInspection = await resolveAppearance(result, { palettes });
void appearance;
void palettes;
void result; void key;
import { createXivapiClient, createMemoryCache, createXivapiResolver, type EquipmentResolution, type XivapiClient } from 'xivcharakit/xivapi';
const transport: XivapiClient = createXivapiClient({ cache: createMemoryCache() });
const equipment: EquipmentResolution = await createXivapiResolver().resolve({ models:[] });
void equipment;
void transport;
import { createDyeNameResolver, type DyeNameResolver } from 'xivcharakit/dyes';
const dyes: DyeNameResolver = createDyeNameResolver();
await dyes.resolve([]);
`,
  );
  runTool(
    process.execPath,
    [
      fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)),
      '--project',
      'tsconfig.json',
    ],
    { cwd: consumer },
  );
  await writeFile(
    `${consumer}/worker.mjs`,
    `import { parentPort } from 'node:worker_threads';
globalThis.fetch = () => { throw new Error('Unexpected network'); };
const { readChara, inspectChara } = await import('xivcharakit');
const result = inspectChara(readChara('{"Body":{"ModelBase":361,"ModelVariant":5}}'));
const { createDefaultPaletteProvider } = await import('xivcharakit/palettes');
const color = await createDefaultPaletteProvider().getColor({ table:'shader', palette:'eyes', index:0 });
if (color?.hex !== '#F7F7F7') throw new Error('Worker palette mismatch');
const { resolveAppearance } = await import('xivcharakit/appearance');
const appearance = await resolveAppearance(inspectChara(readChara('{"LEyeColor":0}')), { palettes:createDefaultPaletteProvider() });
if (appearance.slots.leftEye.displayHex !== '#F7F7F7') throw new Error('Worker appearance mismatch');
const { createXivapiClient, createXivapiResolver } = await import('xivcharakit/xivapi');
const mockedFetch = async () => new Response(JSON.stringify({ version:'0123456789abcdef', schema:'exdschema@2:rev:' + 'a'.repeat(40), rows:[] }));
const transport = createXivapiClient({ fetch:mockedFetch, version:'0123456789abcdef' });
if ((await transport.getGlasses(8)).status !== 'complete') throw new Error('Worker transport mismatch');
const equipment = await createXivapiResolver({ fetch:mockedFetch, version:'0123456789abcdef' }).resolve({ models:[], glassesId:8 });
if (equipment.facewear?.status !== 'notFound') throw new Error('Worker resolution mismatch');
const { createDyeNameResolver } = await import('xivcharakit/dyes');
if ((await createDyeNameResolver().resolve([])).status !== 'complete') throw new Error('Worker dye mismatch');
parentPort.postMessage(result.equipment.Body.model);
`,
  );
  await writeFile(
    `${consumer}/consumer.mjs`,
    `import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
globalThis.fetch = () => { throw new Error('Unexpected network'); };
const { readChara, inspectChara, modelKey } = await import('xivcharakit');
assert.equal(inspectChara(readChara('{"Tribe":"Dunesfolk"}')).identity.canonicalRace, 'Lalafell');
assert.equal(modelKey({ slot:'MainHand', set:634, base:19, variant:1 }), '4296213114');
const { createDefaultPaletteProvider } = await import('xivcharakit/palettes');
assert.equal((await createDefaultPaletteProvider().getColor({ table:'creator', palette:'hair', index:42, tribe:'Raen', gender:'Feminine' }))?.hex, '#FFDC98');
const { resolveAppearance } = await import('xivcharakit/appearance');
const appearance = await resolveAppearance(inspectChara(readChara('{"LEyeColor":0}')), { palettes:createDefaultPaletteProvider() });
assert.equal(appearance.slots.leftEye.displayHex, '#F7F7F7');
const { createXivapiClient, createMemoryCache, createXivapiResolver } = await import('xivcharakit/xivapi');
const transport = createXivapiClient({ cache:createMemoryCache() });
assert.equal((await transport.searchItems([])).status, 'complete');
assert.deepEqual((await createXivapiResolver().resolve({ models:[] })).items, {});
const dyes = await import('xivcharakit/dyes');
assert.equal((await dyes.createDyeNameResolver().resolve([])).status, 'complete');
assert.equal('getDyeName' in dyes, false);
assert.equal('DYE_METADATA' in dyes, false);
const worker = new Worker(new URL('./worker.mjs', import.meta.url));
try {
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker deadline exceeded')), 5000);
    worker.once('message', value => { clearTimeout(timer); resolve(value); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  });
  assert.deepEqual(result, { slot:'Body', base:361, variant:5 });
} finally { await worker.terminate(); }
console.log('Installed tarball: JavaScript, TypeScript, Node Worker, and zero-I/O imports passed.');
`,
  );
  execFileSync(process.execPath, ['consumer.mjs'], {
    cwd: consumer,
    stdio: 'inherit',
  });
  console.log(
    `Package allowlist verified: ${entries.length} files; no runtime dependencies.`,
  );
  await runRuntimeChecks(consumer);
} finally {
  // Check the absolute target before recursively removing the generated consumer.
  assert(
    dirname(resolve(consumer)) === resolve(tmpdir()) &&
      basename(consumer).startsWith('xivcharakit-consumer-'),
    'Unexpected cleanup directory.',
  );
  await rm(consumer, { recursive: true, force: true });
}
