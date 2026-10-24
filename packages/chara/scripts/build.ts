import { cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(packageRoot, 'dist');
if (dirname(output) !== resolve(packageRoot))
  throw new Error('Unexpected build output directory.');
await rm(output, { recursive: true, force: true });
const result = await build({
  // Resolve entry points and the output from the package, not from wherever this was started.
  absWorkingDir: packageRoot,
  entryPoints: {
    index: 'src/index.ts',
    palettes: 'src/palettes/index.ts',
    appearance: 'src/appearance/index.ts',
    dyes: 'src/dyes/index.ts',
    xivapi: 'src/xivapi/index.ts',
  },
  outdir: output,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  sourcemap: false,
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
});
const outputs = result.metafile.outputs;
const main = Object.keys(outputs).find(
  (name) => outputs[name]?.entryPoint === 'src/index.ts',
);
if (!main) throw new Error('Missing main build output.');
const visited = new Set<string>();
function checkMain(name: string): void {
  if (visited.has(name)) return;
  visited.add(name);
  const entry = outputs[name];
  if (!entry) throw new Error('Missing static dependency in build metadata.');
  if (
    Object.keys(entry.inputs).some((input) =>
      /src\/(palettes|appearance|dyes|xivapi)\//.test(input),
    )
  )
    throw new Error('Optional code entered the main static dependency graph.');
  for (const imported of entry.imports)
    if (!imported.external && imported.kind !== 'dynamic-import')
      checkMain(imported.path);
}
checkMain(main);
await cp(
  new URL('../../../LICENSE', import.meta.url),
  resolve(output, 'LICENSE'),
);
await cp(
  new URL('../../../THIRD_PARTY_NOTICES.md', import.meta.url),
  resolve(output, 'THIRD_PARTY_NOTICES.md'),
);
