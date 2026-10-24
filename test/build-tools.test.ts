import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runTool } from '../scripts/run-tool.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'build-tools-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe('running a tool whose output explains its failure', () => {
  it('returns what a successful tool printed', () => {
    expect(
      runTool(process.execPath, ['-e', "process.stdout.write('fine')"]),
    ).toBe('fine');
  });
  it('carries stdout and stderr of a failing tool in the error', () => {
    // TypeScript writes its diagnostics to stdout; execFileSync alone reports only the stderr.
    // The markers are assembled at run time so they are not just echoed from the command line.
    let message = '';
    try {
      runTool(process.execPath, [
        '-e',
        "console.log(['error TS2322: DIAGNOSTIC', 'ON-STDOUT'].join('-')); console.error(['NOTE', 'ON', 'STDERR'].join('-')); process.exit(2)",
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DIAGNOSTIC-ON-STDOUT');
    expect(message).toContain('NOTE-ON-STDERR');
  });
  it('does not hide the exit status', () => {
    // The status must be in the message itself, not only on the error's cause.
    expect(() => runTool(process.execPath, ['-e', 'process.exit(3)'])).toThrow(
      /exit status 3/,
    );
  });
});

describe('the package build script', () => {
  it('builds the package it lives in whatever the working directory is', () => {
    // A replica of the package layout, so the real dist is never touched.
    const replica = join(temp, 'replica');
    cpSync(
      join(repo, 'packages/chara/src'),
      join(replica, 'packages/chara/src'),
      {
        recursive: true,
      },
    );
    cpSync(
      join(repo, 'packages/chara/scripts'),
      join(replica, 'packages/chara/scripts'),
      {
        recursive: true,
      },
    );
    // The package manifests make the script an ES module, as it is in the repository.
    for (const file of [
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      'package.json',
      'packages/chara/package.json',
    ])
      cpSync(join(repo, file), join(replica, file));
    symlinkSync(
      join(repo, 'node_modules'),
      join(replica, 'node_modules'),
      'junction',
    );
    const built = join(replica, 'packages/chara/dist');
    const tsx = join(repo, 'node_modules/tsx/dist/cli.mjs');
    const elsewhere = mkdtempSync(join(temp, 'cwd-'));
    const result = spawnSync(
      process.execPath,
      [tsx, join(replica, 'packages/chara/scripts/build.ts')],
      { cwd: elsewhere, encoding: 'utf8', timeout: 120_000 },
    );
    expect(result.stderr).not.toContain('Could not resolve');
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(built, 'index.js'))).toBe(true);
    expect(existsSync(join(built, 'xivapi.js'))).toBe(true);
    expect(existsSync(join(built, 'LICENSE'))).toBe(true);
    // Nothing may have been written into the directory it was run from.
    expect(existsSync(join(elsewhere, 'dist'))).toBe(false);
  });
});
