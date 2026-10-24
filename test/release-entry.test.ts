import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { assertVersionUnpublished, isEntryPoint } from '../scripts/release.js';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const release = join(scripts, 'release.ts');
const temp = mkdtempSync(join(tmpdir(), 'release-entry-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
// A directory junction (a symlink on Linux): the way a script is reached through a linked checkout.
const linked = join(temp, 'linked-scripts');
symlinkSync(scripts, linked, 'junction');

describe('deciding whether the release script was started directly', () => {
  const url = pathToFileURL(release).href;
  it('is true for the path the module was loaded from', () => {
    expect(isEntryPoint(url, release)).toBe(true);
  });
  it('is true when the script is reached through a symlink or junction', () => {
    expect(isEntryPoint(url, join(linked, 'release.ts'))).toBe(true);
  });
  it('is false for another script, a missing path and no argument', () => {
    expect(isEntryPoint(url, join(scripts, 'package-policy.ts'))).toBe(false);
    expect(isEntryPoint(url, join(temp, 'missing.ts'))).toBe(false);
    expect(isEntryPoint(url, undefined)).toBe(false);
  });
});

describe('running the release script the way the workflow does', () => {
  const { RELEASE_DRY_RUN: _drop, ...env } = process.env;
  const run = (script: string) =>
    spawnSync(
      process.execPath,
      ['--experimental-strip-types', script, 'preflight'],
      {
        env,
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
  it('fails with its own message when started directly without the release inputs', () => {
    const result = run(release);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('RELEASE_DRY_RUN');
  });
  it('does the same through a symlink or junction instead of exiting 0 without doing anything', () => {
    const result = run(join(linked, 'release.ts'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('RELEASE_DRY_RUN');
  });
});

describe('the registry preflight request', () => {
  it('refuses redirects and is bounded by a timeout signal', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));
    await assertVersionUnpublished('0.1.0-beta.1', request);
    const init = request.mock.calls[0]?.[1];
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });
  it('gives the registry fifteen seconds before the signal aborts the request', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      await assertVersionUnpublished(
        '0.1.0-beta.1',
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status: 404 })),
      );
      expect(timeout).toHaveBeenCalledExactlyOnceWith(15_000);
    } finally {
      timeout.mockRestore();
    }
  });
});
