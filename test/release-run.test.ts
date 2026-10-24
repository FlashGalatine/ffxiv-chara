import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReleaseManifest, runRelease } from '../scripts/release.js';

const metadata = {
  name: 'xivcharakit',
  version: '0.1.0-beta.9',
  type: 'module',
  license: 'MIT',
  repository: { url: 'git+https://github.com/FlashGalatine/XIVCharaKit.git' },
  publishConfig: {
    registry: 'https://registry.npmjs.org',
    access: 'public',
    tag: 'next',
  },
};
const baseEnv = {
  EXPECTED_VERSION: metadata.version,
  NPM_TAG: 'next',
  RELEASE_DRY_RUN: 'true',
  NPM_RELEASE_ENABLED: 'false',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'FlashGalatine/XIVCharaKit',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'a'.repeat(40),
};
const context = {
  version: metadata.version,
  tag: 'next',
  dryRun: true,
  releaseEnabled: false,
  event: 'workflow_dispatch',
  repository: 'FlashGalatine/XIVCharaKit',
  ref: 'refs/heads/main',
  commit: 'a'.repeat(40),
};
const filename = `xivcharakit-${metadata.version}.tgz`;
const bytes = Buffer.from('synthetic tarball bytes');
const manifest = createReleaseManifest(metadata, context, bytes);

const temp = mkdtempSync(join(tmpdir(), 'release-run-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let root = '';
let output = '';
let n = 0;
const smoke = () => join(root, '.superpowers', 'package-smoke');
const candidate = () => join(root, '.superpowers', 'release-candidate');
beforeEach(() => {
  root = join(temp, String(++n));
  mkdirSync(join(root, 'packages', 'chara'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'chara', 'package.json'),
    JSON.stringify(metadata),
  );
  output = join(root, 'github-output.txt');
  writeFileSync(output, '');
});
const registry = (status = 404) =>
  vi.fn<typeof fetch>(async () => new Response(null, { status }));
const go = (
  mode: string | undefined,
  env: Record<string, string | undefined> = {},
  request = registry(),
) => {
  const log = vi.fn();
  const done = runRelease({
    root,
    mode,
    env: { ...baseEnv, GITHUB_OUTPUT: output, ...env },
    request,
    log,
  });
  return { done, log, request };
};
const stage = (directory: string) => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, filename), bytes);
};
const stageCandidate = () => {
  stage(candidate());
  writeFileSync(join(candidate(), 'release.json'), JSON.stringify(manifest));
};

describe('release preflight', () => {
  it('checks the registry and needs no tarball', async () => {
    const { done, log, request } = go('preflight');
    await done;
    expect(request).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.join('\n')).toContain('Preflight passed');
    expect(readFileSync(output, 'utf8')).toBe('');
  });
  it('fails when the version is already published', async () => {
    await expect(go('preflight', {}, registry(200)).done).rejects.toThrow(
      /already exists/,
    );
  });
});

describe('release prepare', () => {
  it('records the tarball integrity, without touching the registry', async () => {
    stage(smoke());
    const { done, request } = go('prepare');
    await done;
    expect(request).not.toHaveBeenCalled();
    expect(
      JSON.parse(readFileSync(join(smoke(), 'release.json'), 'utf8')),
    ).toEqual(manifest);
    const lines = readFileSync(output, 'utf8').trim().split('\n');
    expect(lines).toEqual([
      `tarball=${join(smoke(), filename)}`,
      `integrity=${manifest.integrity}`,
    ]);
  });
  it('fails without the tarball', async () => {
    await expect(go('prepare').done).rejects.toThrow();
    expect(existsSync(join(smoke(), 'release.json'))).toBe(false);
  });
});

describe('release verify, the last gate before npm publish', () => {
  const verify = (env: Record<string, string> = {}, request = registry()) =>
    go('verify', { RELEASE_INTEGRITY: manifest.integrity, ...env }, request);
  it('accepts the exact bytes and manifest that preparation recorded', async () => {
    stageCandidate();
    const { done, request } = verify();
    await done;
    expect(request).toHaveBeenCalledTimes(1);
    expect(readFileSync(output, 'utf8')).toContain(
      `integrity=${manifest.integrity}`,
    );
  });
  it('rechecks that the version is still unpublished', async () => {
    stageCandidate();
    await expect(verify({}, registry(200)).done).rejects.toThrow(
      /already exists/,
    );
    await expect(
      verify({}, vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))
        .done,
    ).rejects.toThrow();
  });
  it('rejects an integrity that differs from the verification job output', async () => {
    stageCandidate();
    await expect(
      verify({ RELEASE_INTEGRITY: `sha512-${'A'.repeat(86)}==` }).done,
    ).rejects.toThrow();
    await expect(verify({ RELEASE_INTEGRITY: '' }).done).rejects.toThrow();
  });
  it('rejects changed tarball bytes', async () => {
    stageCandidate();
    writeFileSync(join(candidate(), filename), Buffer.from('tampered'));
    await expect(verify().done).rejects.toThrow();
  });
  it('rejects a manifest that was edited or is missing', async () => {
    stageCandidate();
    writeFileSync(
      join(candidate(), 'release.json'),
      JSON.stringify({ ...manifest, commit: 'b'.repeat(40) }),
    );
    await expect(verify().done).rejects.toThrow();
    rmSync(join(candidate(), 'release.json'));
    await expect(verify().done).rejects.toThrow();
  });
});

describe('release inputs', () => {
  it('fails on an unknown or missing mode before reading any tarball', async () => {
    await expect(go('publish').done).rejects.toThrow(/Unknown release mode/);
    await expect(go(undefined).done).rejects.toThrow(/Unknown release mode/);
  });
  it('requires the dry-run flag and a valid dispatch', async () => {
    await expect(
      go('preflight', { RELEASE_DRY_RUN: undefined }).done,
    ).rejects.toThrow(/RELEASE_DRY_RUN/);
    await expect(
      go('preflight', { GITHUB_REPOSITORY: 'someone/else' }).done,
    ).rejects.toThrow();
    await expect(
      go('preflight', { GITHUB_EVENT_NAME: 'push' }).done,
    ).rejects.toThrow();
    await expect(
      go('preflight', { EXPECTED_VERSION: '0.1.0-beta.1' }).done,
    ).rejects.toThrow();
  });
  it('does not call the registry when the request is invalid', async () => {
    const { done, request } = go('preflight', {
      GITHUB_REF: 'refs/heads/feature',
    });
    await expect(done).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
