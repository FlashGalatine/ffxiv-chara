import { expect, it } from 'vitest';
import { assertPublicArtifact } from '../scripts/package-policy.js';

it.each([
  ['package/dist/read.js', 'export const code = "INVALID_JSON";'],
  // Near misses that must stay admitted: a token one character short, and prose that mentions paths.
  ['package/dist/file.js', `ghp_${'a'.repeat(19)}`],
  [
    'package/dist/file.js',
    'const note = "see the Users guide and the dev notes";',
  ],
  [
    'package/dist/dyes.js',
    'const source = "https://raw.githubusercontent.com/xivapi/data/commit/Stain.csv";',
  ],
  [
    'apps/demo/dist/examples/example.chara',
    '{"Nickname":"Synthetic example","HairTone":0}',
  ],
])('admits expected public artifact %s', (path, text) => {
  expect(() => assertPublicArtifact(path, text)).not.toThrow();
});

it.each([
  ['package/dist/source.map', '{}'],
  ['package/dist/human.cmp', 'binary'],
  ['package/.env', 'VALUE=private'],
  ['package/../outside.js', 'export {};'],
  ['package/dist/file.js', 'const origin = "C:\\Users\\Someone\\private.ts";'],
  [
    'package/dist/file.js',
    'const origin = "/home/runner/work/project/source.ts";',
  ],
  // One input per alternative, each matching only that branch.
  ['package/dist/file.js', 'const source = "CharaSamples/test.chara";'],
  ['package/dist/file.js', 'const origin = "D:/dev/example/project.ts";'],
  [
    'package/dist/file.js',
    'const origin = "/Users/someone/project/source.ts";',
  ],
  ['package/dist/file.js', 'const origin = "/workspace/project/source.ts";'],
  ['package/dist/file.js', 'const origin = "/workspaces/project/source.ts";'],
  ['package/dist/file.js', 'const origin = "/tmp/build/source.ts";'],
  ['package/dist/file.js', 'const origin = "/private/var/build/source.ts";'],
  ['package/dist/file.js', 'const origin = "/var/folders/ab/source.ts";'],
  ['/etc/passwd', 'export {};'],
  ['D:/package/dist/file.js', 'export {};'],
  ['package/.env.production', 'VALUE=private'],
  ['package/dist/file.js', '-----BEGIN RSA PRIVATE KEY-----'],
  ['package/dist/file.js', `gho_${'a'.repeat(20)}`],
  ['package/dist/file.js', `ghu_${'a'.repeat(20)}`],
  ['package/dist/file.js', `ghs_${'a'.repeat(20)}`],
  ['package/dist/file.js', `ghr_${'a'.repeat(20)}`],
  ['package/dist/file.js', 'PRIVATE_IMAGE_CANARY'],
  ['package/dist/file.js', '-----BEGIN PRIVATE KEY-----'],
  ['package/dist/file.js', `ghp_${'a'.repeat(36)}`],
  ['package/dist/file.js', '//# sourceMappingURL=file.js.map'],
])('rejects private or unintended content in %s', (path, text) => {
  expect(() => assertPublicArtifact(path, text)).toThrow();
});
