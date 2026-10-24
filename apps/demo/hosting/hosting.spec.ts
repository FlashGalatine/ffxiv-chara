import { readdir, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// A reviewed copy of the policy, not an import of the one under test: weakening the header in
// vite.config.ts (an extra host, a dropped directive, unsafe-inline) must fail here until a
// reviewer changes both.
const POLICY: Record<string, string[]> = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'worker-src': ["'self'"],
  'connect-src': ["'self'", 'https://v2.xivapi.com'],
  'img-src': ["'self'", 'blob:'],
  'font-src': ["'self'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
};
function directives(header: string): Record<string, string[]> {
  const parsed: Record<string, string[]> = {};
  for (const part of header.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (!name) continue;
    // Browsers use the first of a repeated directive, so a repeat can hide a weaker one.
    expect(parsed, `repeated directive ${name}`).not.toHaveProperty(name);
    parsed[name] = values.sort();
  }
  return parsed;
}
const expectedPolicy = Object.fromEntries(
  Object.entries(POLICY).map(([name, values]) => [name, [...values].sort()]),
);

test('protects the served document, module worker and legal files with security headers', async ({
  request,
}) => {
  const assets = await readdir(new URL('../dist/assets/', import.meta.url));
  const worker = assets.find((name) => /^worker-[\w-]+\.js$/.test(name));
  expect(worker).toBeTruthy();
  for (const path of [
    '/',
    `/assets/${worker}`,
    '/LICENSE.txt',
    '/THIRD_PARTY_NOTICES.txt',
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['cache-control']).toContain('no-transform');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=()',
    );
    expect(directives(headers['content-security-policy'] ?? '')).toEqual(
      expectedPolicy,
    );
    if (path === '/') {
      expect(headers['content-type']).toContain('text/html');
      expect(await response.body()).toEqual(
        await readFile(new URL('../dist/index.html', import.meta.url)),
      );
    }
    if (path.endsWith('.js'))
      expect(headers['content-type']).toMatch(
        /(?:application|text)\/javascript/,
      );
    if (path.endsWith('.txt'))
      expect(headers['content-type']).toContain('text/plain');
  }
});

test('does not expose repository inputs or substitute HTML for missing assets', async ({
  request,
}) => {
  for (const path of [
    '/package.json',
    '/fixtures/manifest.json',
    '/fixtures/producer-exports/README.md',
    '/human.cmp',
    '/_headers',
    '/assets/missing.js',
    '/assets/missing.js.map',
  ]) {
    const response = await request.get(path, {
      headers: { Accept: 'text/html' },
    });
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('<!doctype html>');
  }
});
