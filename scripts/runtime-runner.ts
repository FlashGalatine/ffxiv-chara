import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { runTool } from './run-tool.js';

const expected = {
  entries: 5,
  identity: 'Hyur',
  model: '328041',
  eye: '#F7F7F7',
  dye: 'Synthetic dye',
  mockedRequests: 2,
  unexpectedNetwork: 0,
};

export async function runRuntimeChecks(consumer: string): Promise<void> {
  for (const file of [
    'smoke.ts',
    'browser.ts',
    'worker.ts',
    'cloudflare.ts',
    'wrangler.toml',
  ])
    await copyFile(
      new URL(`../test/runtime/${file}`, import.meta.url),
      resolve(consumer, file),
    );
  await writeFile(
    resolve(consumer, 'runtime-tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2022',
        module: 'NodeNext',
        lib: ['ES2022', 'DOM'],
        types: [],
      },
      files: ['smoke.ts', 'browser.ts', 'worker.ts', 'cloudflare.ts'],
    }),
  );
  runTool(
    process.execPath,
    [
      fileURLToPath(
        new URL('../node_modules/typescript/bin/tsc', import.meta.url),
      ),
      '-p',
      'runtime-tsconfig.json',
    ],
    { cwd: consumer, timeout: 15000 },
  );
  await writeFile(
    resolve(consumer, 'node-runtime.ts'),
    `
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { smoke } from './smoke.js';
const result = await smoke();
if (isMainThread) {
  assert.deepEqual(result, ${JSON.stringify(expected)});
  const worker = new Worker(new URL(import.meta.url));
  try { await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Node Worker deadline')), 10000);
    worker.once('message', value => { clearTimeout(timer); try { assert.deepEqual(value, result); resolve(value); } catch (error) { reject(error); } });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  }); } finally { await worker.terminate(); }
} else parentPort.postMessage(result);
`,
  );
  await build({
    absWorkingDir: consumer,
    entryPoints: ['node-runtime.ts'],
    outfile: 'node-runtime.mjs',
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
  });
  execFileSync(process.execPath, ['node-runtime.mjs'], {
    cwd: consumer,
    stdio: 'inherit',
    timeout: 20000,
  });
  const bundle = await build({
    absWorkingDir: consumer,
    entryPoints: ['browser.ts', 'worker.ts'],
    outdir: 'browser-bundle',
    bundle: true,
    splitting: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    metafile: true,
  });
  const libraryInputs = Object.keys(bundle.metafile.inputs).filter((path) =>
    path.includes('xivcharakit'),
  );
  assert(libraryInputs.length > 0, 'No installed package was bundled.');
  const installed = resolve(consumer, 'node_modules/xivcharakit');
  for (const path of libraryInputs) {
    const within = relative(installed, resolve(consumer, path));
    assert(
      within &&
        within !== '..' &&
        !within.startsWith(`..${sep}`) &&
        !isAbsolute(within),
      'Workspace source entered the runtime consumer.',
    );
  }
  const directory = resolve(consumer, 'browser-bundle');
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'",
      );
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(
          '<!doctype html><title>Installed package smoke</title><body>Running<script type="module" src="/browser.js"></script>',
        );
      } else if (pathname === '/favicon.ico') {
        response.statusCode = 204;
        response.end();
      } else {
        const path = resolve(directory, `.${decodeURIComponent(pathname)}`);
        assert(path.startsWith(directory + sep) && path.endsWith('.js'));
        response.setHeader('Content-Type', 'text/javascript');
        response.end(await readFile(path));
      }
    } catch {
      response.statusCode = 404;
      response.end();
    }
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true, timeout: 20000 });
    const page = await browser.newPage();
    const external: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(origin);
    await page.waitForFunction(
      () => 'runtimeResults' in globalThis,
      undefined,
      { timeout: 10000 },
    );
    const results = await page.evaluate(
      () =>
        (globalThis as unknown as { runtimeResults: Promise<unknown> })
          .runtimeResults,
    );
    assert.deepEqual(results, [expected, expected]);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  process.env.WRANGLER_SEND_METRICS = 'false';
  const { createTestHarness } = await import('wrangler');
  const harness = createTestHarness({
    root: consumer,
    workers: [{ configPath: 'wrangler.toml' }],
  });
  try {
    await harness.listen();
    const response = await harness.fetch('/smoke', {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  } finally {
    await harness.close();
  }
  console.log(
    'Installed tarball: shared smoke passed in Node, Node Worker, Chromium, module Web Worker and local Wrangler/workerd; 5 exports, zero native API requests (one probe per runtime, to a closed loopback port).',
  );
}
