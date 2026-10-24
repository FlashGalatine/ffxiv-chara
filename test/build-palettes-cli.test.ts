import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// The command line of scripts/build-palettes.ts: what it accepts as arguments, and the size gate it
// applies to the file before reading any of it. The script runs from a replica of the repository
// layout, so a regression cannot touch the committed palettes.

const repo = fileURLToPath(new URL('../', import.meta.url));
const tsx = join(repo, 'node_modules/tsx/dist/cli.mjs');
const temp = mkdtempSync(join(tmpdir(), 'build-palettes-cli-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

// The write-mode tests change the palettes of their replica, so they have one of their own.
const replica = (name: string): string => {
  const dir = join(temp, name);
  mkdirSync(join(dir, 'packages/chara'), { recursive: true });
  cpSync(join(repo, 'scripts'), join(dir, 'scripts'), { recursive: true });
  cpSync(join(repo, 'packages/chara/src'), join(dir, 'packages/chara/src'), {
    recursive: true,
  });
  for (const file of ['package.json', 'packages/chara/package.json'])
    cpSync(join(repo, file), join(dir, file));
  return dir;
};
const checking = replica('checking');
const writing = replica('writing');

const MIN = 182_272;
const MAX = 16 * 1024 * 1024;
let counter = 0;
const source = (size: number): string => {
  const file = join(temp, `source-${++counter}.cmp`);
  writeFileSync(file, Buffer.alloc(0));
  truncateSync(file, size);
  return file;
};
const runIn = (dir: string, args: string[], cwd?: string) =>
  spawnSync(
    process.execPath,
    [tsx, join(dir, 'scripts/build-palettes.ts'), ...args],
    { encoding: 'utf8', timeout: 120_000, ...(cwd ? { cwd } : {}) },
  );
const run = (...args: string[]) => runIn(checking, args);
const write = (...args: string[]) => runIn(writing, args);
const USAGE = 'Usage: build-palettes.ts';

describe('the arguments', () => {
  const file = source(MIN);
  it.each([
    ['none', []],
    ['only the flag as the path', ['--check']],
    ['a path with neither --check nor a dataset version', [file]],
    ['--dataset-version without a value', [file, '--dataset-version']],
    [
      '--dataset-version last, after --game-version, without a value',
      [file, '--game-version', '8.0', '--dataset-version'],
    ],
  ])('refuse %s with the usage text', (_name, args) => {
    const result = run(...args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(USAGE);
  });
  it.each(['', '-x', '.x', '_x', 'a b', 'a/b', 'é', 'a'.repeat(65)])(
    'refuse the dataset version %j',
    (version) => {
      const result = run(file, '--dataset-version', version);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(USAGE);
    },
  );
  it.each([
    '8',
    '8.',
    '.8',
    '8.0.0.0',
    'x.y',
    '1234.5',
    '8.0.',
    '8.1234',
    '7.5.1234',
    '8.0-beta',
    '',
    ' 8.0',
  ])('refuse the game version %j, in check mode too', (version) => {
    for (const mode of [['--check'], ['--dataset-version', 'v1']]) {
      const result = run(file, ...mode, '--game-version', version);
      expect(result.status, `${mode} ${version}`).not.toBe(0);
      expect(result.stderr).toContain(USAGE);
    }
  });
  it('does not take the path for the dataset version when --dataset-version is missing', () => {
    // A path that would pass as a version string ("human.cmp") must not be mistaken for one.
    const name = 'human.cmp';
    cpSync(file, join(temp, name));
    const result = runIn(writing, [name], temp);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(USAGE);
  });
  it('refuses --game-version without a value', () => {
    const result = run(file, '--check', '--game-version');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(USAGE);
  });
  it.each(['a', 'A1', 'x.y_z-1', '2026-10-24', 'a'.repeat(64)])(
    'accept the dataset version %j',
    (version) => {
      const result = write(file, '--dataset-version', version);
      expect(result.status, result.stderr).toBe(0);
    },
  );
  it.each(['8.0', '10.57', '7.5.1', '999.999.999'])(
    'accept the game version %s',
    (version) => {
      const result = write(
        file,
        '--dataset-version',
        'v1',
        '--game-version',
        version,
      );
      expect(result.status, result.stderr).toBe(0);
    },
  );
  it('accepts the --check flag after the path, and ignores a bare -- separator', () => {
    const result = run('--', file, '--check');
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'check' });
  });
});

describe('the size gate, applied to the file before any of it is read', () => {
  const GATE =
    'Source file must be a regular file whose size is a multiple of 4';
  const REFUSED_SIZES: [string, number][] = [
    ['an empty file', 0],
    ['a file one entry short of the layout', MIN - 4],
    ['a file under the layout by one byte', MIN - 1],
    ['a file whose size is not a multiple of 4', MIN + 1],
    ['a file above the limit', MAX + 4],
  ];
  it.each(REFUSED_SIZES)('refuses %s with its own message', (_name, size) => {
    const result = run(source(size), '--check');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(GATE);
    // The message of the layout check that runs after reading is a different one.
    expect(result.stderr).not.toContain('Invalid human.cmp layout.');
    expect(result.stdout).toBe('');
  });
  it('refuses a directory, and a path that does not exist', () => {
    for (const path of [temp, join(temp, 'missing.cmp')]) {
      const result = run(path, '--check');
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
    }
    expect(run(temp, '--check').stderr).toContain(GATE);
  });
  it.each([
    ['the smallest layout', MIN],
    ['the largest size', MAX],
  ])('lets %s through to the check', (_name, size) => {
    const result = run(source(size), '--check');
    expect(result.stderr).not.toContain(GATE);
    // A file of zeros is a valid layout that does not match the committed palettes.
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: 'check',
      sourceBytes: size,
      matchesCommitted: false,
    });
    expect(result.status).toBe(1);
  });

  // The script opens the source with fs.promises.open and reads it with FileHandle.read. A preload,
  // given to the script's own process after tsx's launcher, leaves a marker file the first time that
  // method is called, so a refusal that came after a read would show.
  const probe = join(temp, 'read-probe.mjs');
  writeFileSync(
    probe,
    [
      "import { promises, writeFileSync } from 'node:fs';",
      "const handle = await promises.open(process.execPath, 'r');",
      'const prototype = Object.getPrototypeOf(handle);',
      'await handle.close();',
      'const read = prototype.read;',
      'prototype.read = function (...args) {',
      "  writeFileSync(process.env.READ_PROBE, 'read');",
      '  return read.apply(this, args);',
      '};',
    ].join('\n'),
  );
  const probed = (size: number) => {
    const marker = join(temp, `marker-${++counter}`);
    const result = spawnSync(
      process.execPath,
      [
        tsx,
        '--import',
        pathToFileURL(probe).href,
        join(checking, 'scripts/build-palettes.ts'),
        source(size),
        '--check',
      ],
      {
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, READ_PROBE: marker },
      },
    );
    return { result, read: existsSync(marker) };
  };
  it('reads a file of an admitted size, which shows that the probe is in place', () => {
    const { result, read } = probed(MIN);
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: 'check',
      sourceBytes: MIN,
    });
    expect(read).toBe(true);
  });
  it.each(REFUSED_SIZES)('does not read a byte of %s', (_name, size) => {
    const { result, read } = probed(size);
    expect(result.stderr).toContain(GATE);
    expect(read).toBe(false);
  });
});
