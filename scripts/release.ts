import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Metadata {
  name: string;
  version: string;
  private?: boolean;
  license?: string;
  type?: string;
  repository?: { url: string };
  publishConfig?: { registry: string; access: string; tag: string };
  dependencies?: Record<string, string>;
}
interface ReleaseContext {
  version: string;
  tag: string;
  dryRun: boolean;
  releaseEnabled: boolean;
  event: string;
  repository: string;
  ref: string;
  commit: string;
}

function assertVersion(version: string): void {
  assert(
    typeof version === 'string' && version.length <= 100,
    'Invalid version.',
  );
  assert(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      version,
    ),
    'Invalid version.',
  );
  const prerelease = version.split('-').slice(1).join('-');
  assert(
    !prerelease.split('.').some((part) => /^0\d+$/.test(part)),
    'Noncanonical prerelease.',
  );
}

export function getPackageArtifactName(metadata: Metadata): string {
  assert.equal(metadata.name, 'xivcharakit', 'Unexpected package name.');
  assertVersion(metadata.version);
  return `xivcharakit-${metadata.version}.tgz`;
}

export function validateReleaseRequest(
  metadata: Metadata,
  context: ReleaseContext,
): void {
  getPackageArtifactName(metadata);
  assert.equal(
    context.version,
    metadata.version,
    'Input must match the committed version.',
  );
  assert.equal(
    context.event,
    'workflow_dispatch',
    'Only manual dispatch is permitted.',
  );
  assert.equal(
    context.repository,
    'FlashGalatine/XIVCharaKit',
    'Unexpected repository.',
  );
  assert.equal(
    context.ref,
    'refs/heads/main',
    'Release candidates must come from main.',
  );
  assert(/^[a-f0-9]{40}$/.test(context.commit), 'Invalid source commit.');
  assert(
    typeof context.dryRun === 'boolean' &&
      typeof context.releaseEnabled === 'boolean',
    'Invalid release controls.',
  );
  assert(
    context.dryRun || context.releaseEnabled,
    'Complete release setup and set NPM_RELEASE_ENABLED=true first.',
  );
  assert(
    context.tag === 'next' || context.tag === 'latest',
    'Invalid npm tag.',
  );
  assert(
    !(metadata.version.includes('-') && context.tag === 'latest'),
    'Prereleases must not use latest.',
  );
  assert.notEqual(metadata.private, true, 'Library is private.');
  assert.equal(metadata.license, 'MIT');
  assert.equal(metadata.type, 'module');
  assert.equal(
    metadata.repository?.url,
    'git+https://github.com/FlashGalatine/XIVCharaKit.git',
  );
  assert.equal(metadata.publishConfig?.registry, 'https://registry.npmjs.org');
  assert.equal(metadata.publishConfig?.access, 'public');
  assert.equal(
    metadata.publishConfig?.tag,
    context.tag,
    'Tag must match committed publishConfig.',
  );
  assert.equal(
    Object.keys(metadata.dependencies ?? {}).length,
    0,
    'Review new runtime dependencies before releasing.',
  );
}

export function createReleaseManifest(
  metadata: Metadata,
  context: ReleaseContext,
  bytes: Uint8Array,
) {
  validateReleaseRequest(metadata, context);
  return {
    schema: 1,
    name: metadata.name,
    version: metadata.version,
    tag: context.tag,
    filename: getPackageArtifactName(metadata),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    commit: context.commit,
    repository: context.repository,
  };
}

export function validateReleaseManifest(
  manifest: unknown,
  metadata: Metadata,
  context: ReleaseContext,
  bytes: Uint8Array,
  expectedIntegrity: string,
): void {
  const expected = createReleaseManifest(metadata, context, bytes);
  assert.deepEqual(
    manifest,
    expected,
    'Candidate manifest or bytes differ from the verified release.',
  );
  assert.equal(
    expected.integrity,
    expectedIntegrity,
    'Candidate differs from the verification job output.',
  );
}

export async function assertVersionUnpublished(
  version: string,
  request: typeof fetch = fetch,
): Promise<void> {
  assertVersion(version);
  const response = await request(
    `https://registry.npmjs.org/xivcharakit/${version}`,
    {
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    },
  );
  await response.body?.cancel();
  assert.equal(
    response.status,
    404,
    response.status === 200
      ? 'Version already exists on npm.'
      : `Registry preflight failed: HTTP ${response.status}.`,
  );
}

export interface RunReleaseOptions {
  /** Repository root: where packages/chara/package.json and .superpowers live. */
  root: string;
  /** The release step: preflight, prepare or verify. */
  mode: string | undefined;
  env: Record<string, string | undefined>;
  request?: typeof fetch;
  log?: (message: string) => void;
}

/** One release step, with every input it reads passed in so the three modes can be tested. */
export async function runRelease({
  root,
  mode,
  env,
  request = fetch,
  log = console.log,
}: RunReleaseOptions): Promise<void> {
  const metadata: Metadata = JSON.parse(
    await readFile(join(root, 'packages/chara/package.json'), 'utf8'),
  );
  assert(
    env.RELEASE_DRY_RUN === 'true' || env.RELEASE_DRY_RUN === 'false',
    'RELEASE_DRY_RUN must be true or false.',
  );
  const context: ReleaseContext = {
    version: env.EXPECTED_VERSION ?? '',
    tag: env.NPM_TAG ?? '',
    dryRun: env.RELEASE_DRY_RUN === 'true',
    releaseEnabled: env.NPM_RELEASE_ENABLED === 'true',
    event: env.GITHUB_EVENT_NAME ?? '',
    repository: env.GITHUB_REPOSITORY ?? '',
    ref: env.GITHUB_REF ?? '',
    commit: env.GITHUB_SHA ?? '',
  };
  validateReleaseRequest(metadata, context);
  assert(
    mode === 'preflight' || mode === 'prepare' || mode === 'verify',
    'Unknown release mode.',
  );
  if (mode === 'preflight' || mode === 'verify')
    await assertVersionUnpublished(metadata.version, request);
  if (mode !== 'preflight') {
    const directory = join(
      root,
      '.superpowers',
      mode === 'prepare' ? 'package-smoke' : 'release-candidate',
    );
    const tarball = join(directory, getPackageArtifactName(metadata));
    const bytes = await readFile(tarball);
    const manifest = createReleaseManifest(metadata, context, bytes);
    if (mode === 'prepare')
      await writeFile(
        join(directory, 'release.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    else
      validateReleaseManifest(
        JSON.parse(await readFile(join(directory, 'release.json'), 'utf8')),
        metadata,
        context,
        bytes,
        env.RELEASE_INTEGRITY ?? '',
      );
    if (env.GITHUB_OUTPUT)
      await appendFile(
        env.GITHUB_OUTPUT,
        `tarball=${tarball}\nintegrity=${manifest.integrity}\n`,
      );
    log(`${mode}: ${manifest.filename} ${manifest.integrity}`);
  } else
    log(
      `Preflight passed: ${metadata.name}@${metadata.version}, tag ${context.tag}, dry run ${context.dryRun}.`,
    );
}

async function main(): Promise<void> {
  await runRelease({
    root: fileURLToPath(new URL('../', import.meta.url)),
    mode: process.argv[2],
    env: process.env,
  });
}

/**
 * Whether this module is the script Node was started with. Node realpaths a module's URL but not
 * argv[1], so a script reached through a symlink or junction never compared equal and exited 0
 * without doing anything; compare real paths instead.
 */
export function isEntryPoint(
  moduleUrl: string,
  argv1: string | undefined,
): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) await main();
