import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { readChara } from '../src/index.js';

// Removing a parser limit or retaining an image must fail these admission tests.
function rejects(input: unknown, code: string, options?: unknown) {
  expect(() => readChara(input as string, options as never)).toThrow(
    expect.objectContaining({ name: 'CharaInputError', code }),
  );
}

describe('binary input from another realm', () => {
  const text = '{"Race":"Hyur","Hair":3}';
  const bytes = [...Buffer.from(text)].join(',');
  it('reads a Uint8Array created in another realm', () => {
    const foreign = runInNewContext(`new Uint8Array([${bytes}])`) as Uint8Array;
    expect(foreign instanceof Uint8Array).toBe(false); // the point of the test
    expect(readChara(foreign).fields).toMatchObject({ Race: 'Hyur', Hair: 3 });
  });
  it('reads only the window of a larger foreign buffer', () => {
    const foreign = runInNewContext(
      `const all = new Uint8Array(64).fill(0x7a); all.set([${bytes}], 11); all.subarray(11, 11 + ${text.length})`,
    ) as Uint8Array;
    expect(foreign.byteOffset).toBe(11);
    expect(readChara(foreign).fields).toMatchObject({ Race: 'Hyur', Hair: 3 });
  });
  it('rejects a Uint8Array whose buffer was transferred away, with the fixed error', () => {
    const view = new Uint8Array(Buffer.from(text));
    structuredClone(view.buffer, { transfer: [view.buffer] });
    expect(view.byteLength).toBe(0); // detached
    rejects(view, 'INVALID_INPUT');
  });
  it('reads the real bytes when own properties shadow the view', () => {
    const view = new Uint8Array(Buffer.from(text));
    for (const key of ['buffer', 'byteOffset', 'byteLength'])
      Object.defineProperty(view, key, {
        value: key === 'buffer' ? new ArrayBuffer(1) : 1e9,
      });
    expect(readChara(view).fields).toMatchObject({ Race: 'Hyur', Hair: 3 });
  });
  it('still reads a Buffer and an ordinary Uint8Array', () => {
    expect(readChara(Buffer.from(text)).fields).toMatchObject({ Hair: 3 });
    expect(readChara(new Uint8Array(Buffer.from(text))).fields).toMatchObject({
      Hair: 3,
    });
  });
  it.each([
    ['an ArrayBuffer', () => new ArrayBuffer(8)],
    ['a Uint8ClampedArray', () => new Uint8ClampedArray(8)],
    ['an Int8Array', () => new Int8Array(8)],
    ['a DataView', () => new DataView(new ArrayBuffer(8))],
    [
      'an object that only inherits Uint8Array.prototype',
      () => Object.create(Uint8Array.prototype),
    ],
    [
      'an object that fakes the Uint8Array tag',
      () => ({ [Symbol.toStringTag]: 'Uint8Array', byteLength: 8 }),
    ],
  ])('rejects %s with the fixed error', (_name, make) => {
    rejects(make(), 'INVALID_INPUT');
  });
});

describe('bounded character reader', () => {
  it.each([
    [
      '{"PRIVATE_PAYLOAD_KEY":{"Base64Image":"PRIVATE_PAYLOAD_VALUE"}}',
      'object',
    ],
    [
      '[{"PRIVATE_PAYLOAD_KEY":{"Base64Image":"PRIVATE_PAYLOAD_VALUE"}}]',
      'array',
    ],
  ])(
    'does not expose descendants of an omitted non-string image payload %s',
    (payload, type) => {
      const doc = readChara(`{"Hair":0,"Base64Image":${payload}}`);
      expect(JSON.stringify(doc)).not.toContain('PRIVATE_PAYLOAD');
      expect(doc.embeddedImages).toEqual([{ path: ['Base64Image'], type }]);
      rejects(
        '{"Hair":0,"Base64Image":{"PRIVATE":{"a":1,"a":2}}}',
        'DUPLICATE_KEY',
      );
    },
  );
  it.each([
    { Race: 'Hyur', Tribe: 'Midlander', Skintone: 0 },
    { Body: { ModelBase: 361, ModelVariant: 5 } },
    { Glasses: { GlassesId: 0 } },
    { EnableHighlights: false },
    { SkinColor: '0, 0.25, 1' },
    { HairTone: null },
  ])('admits a supported full or partial shape %j', (fields) => {
    expect(readChara(JSON.stringify(fields))).toHaveProperty('fields', fields);
  });

  it.each([
    '[]',
    'null',
    'true',
    '42',
    '"a"',
    '{}',
    '{"Bones":{}}',
    '{"TypeName":"Brio Character File"}',
  ])('rejects non-character %s', (input) => {
    rejects(input, 'NOT_CHARACTER');
  });

  it.each([
    '',
    '{',
    '{"Hair":1,}',
    '{"Hair":01}',
    '{"Hair":+1}',
    '{"Hair":.1}',
    '{"Hair":1e}',
    '{"Hair":"\\q"}',
    '{"Hair":1} trailing',
    '{"Hair":true false}',
    '{"Hair":[1,]}',
  ])('rejects invalid JSON without exposing input %s', (input) => {
    rejects(input, 'INVALID_JSON');
  });

  it('accepts one BOM in string and byte input and counts its bytes', () => {
    const text = '\uFEFF{"Hair":1}';
    expect(readChara(text)).toHaveProperty('fields.Hair', 1);
    expect(readChara(new TextEncoder().encode(text))).toHaveProperty(
      'fields.Hair',
      1,
    );
    rejects(text, 'INPUT_TOO_LARGE', { maxBytes: 10 });
    rejects(`\uFEFF${text}`, 'INVALID_JSON');
  });

  it('counts UTF-8 bytes including multibyte and supplementary characters', () => {
    const text = '{"Hair":0,"Nickname":"é😀"}';
    const bytes = new TextEncoder().encode(text);
    expect(readChara(text, { maxBytes: bytes.length })).toHaveProperty(
      'fields.Hair',
      0,
    );
    expect(readChara(bytes, { maxBytes: bytes.length })).toHaveProperty(
      'fields.Hair',
      0,
    );
    rejects(text, 'INPUT_TOO_LARGE', { maxBytes: bytes.length - 1 });
    rejects(bytes, 'INPUT_TOO_LARGE', { maxBytes: bytes.length - 1 });
    rejects(new Uint8Array([0xc3, 0x28]), 'INVALID_UTF8');
  });

  it('counts root depth as one and includes values and property nodes', () => {
    expect(
      readChara('{"Hair":1}', { maxDepth: 2, maxNodes: 3 }),
    ).toHaveProperty('fields.Hair', 1);
    rejects('{"Hair":1}', 'MAX_DEPTH', { maxDepth: 1 });
    rejects('{"Hair":1}', 'MAX_NODES', { maxNodes: 2 });
    rejects('{"Hair":0,"x":[[1]]}', 'MAX_DEPTH', { maxDepth: 3 });
    rejects(`{"Hair":0,"x":[${'0,'.repeat(100)}0]}`, 'MAX_NODES', {
      maxNodes: 40,
    });
  });

  it('handles braces and escaped quotes as string data', () => {
    const text = JSON.stringify({ Hair: 0, x: '{["}\\\n\u0000' });
    expect(readChara(text)).toHaveProperty('fields.x', JSON.parse(text).x);
  });

  it('rejects decoded duplicates at every depth, including skipped images', () => {
    for (const text of [
      '{"Hair":1,"H\\u0061ir":2}',
      '{"Hair":1,"x":{"a":1,"a":2}}',
      '{"Hair":1,"Base64Image":{"a":0,"a":1}}',
    ]) {
      rejects(text, 'DUPLICATE_KEY');
    }
  });

  it.each(['1e999', '9007199254740993', '-9007199254740993'])(
    'rejects unsafe numeric token %s',
    (token) => {
      rejects(`{"Hair":0,"x":${token}}`, 'INVALID_NUMBER');
    },
  );

  it('bounds decoded key and ordinary string lengths', () => {
    expect(
      readChara('{"Hair":0,"x":"\\u0061b"}', { maxStringLength: 2 }),
    ).toHaveProperty('fields.x', 'ab');
    rejects('{"Hair":0,"x":"\\u0061bc"}', 'MAX_STRING_LENGTH', {
      maxStringLength: 2,
    });
    rejects('{"Hair":0}', 'MAX_KEY_LENGTH', { maxKeyLength: 3 });
  });

  it.each([NaN, Infinity, 0, -1, 1.1, '4', null])(
    'rejects invalid options %s',
    (value) => {
      for (const key of [
        'maxBytes',
        'maxDepth',
        'maxNodes',
        'maxKeyLength',
        'maxStringLength',
        'maxIssues',
      ]) {
        rejects('{"Hair":0}', 'INVALID_OPTIONS', { [key]: value });
      }
    },
  );

  it('rejects options over host ceilings and non-input values', () => {
    rejects('{"Hair":0}', 'INVALID_OPTIONS', { maxDepth: 1000 });
    rejects('{"Hair":0}', 'INVALID_OPTIONS', null);
    rejects({}, 'INVALID_INPUT');
  });

  it('retains prototype-shaped properties recursively as inert own data', () => {
    const doc = readChara(
      '{"Hair":0,"__proto__":{"polluted":true},"x":{"constructor":{"prototype":{"polluted":true}}}}',
    );
    expect(Object.getPrototypeOf(doc.fields)).toBeNull();
    expect(Object.getPrototypeOf(doc.fields.x)).toBeNull();
    expect(Object.hasOwn(doc.fields, '__proto__')).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(doc.fields, '__proto__')?.value,
    ).toEqual({ polluted: true });
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('omits every decoded case-insensitive image key, including arrays', () => {
    const doc = readChara(
      '{"Hair":0,"Base64Image":"PRIVATE","x":[{"bAse64Im\\u0061ge":"PRIVATE"}]}',
    );
    expect(doc.hasEmbeddedImage).toBe(true);
    expect(doc.embeddedImages).toHaveLength(2);
    expect(JSON.stringify(doc)).not.toContain('PRIVATE');
    expect(doc.fields).not.toHaveProperty('Base64Image');
    expect(doc.fields.x).toEqual([{}]);
  });

  it('skips long image strings but still applies byte and structural limits', () => {
    const text = JSON.stringify({ Hair: 0, Base64Image: 'a'.repeat(100_000) });
    expect(readChara(text, { maxStringLength: 1 }).hasEmbeddedImage).toBe(true);
    rejects(text, 'INPUT_TOO_LARGE', { maxBytes: 20 });
    rejects('{"Hair":0,"Base64Image":[[[1]]]}', 'MAX_DEPTH', { maxDepth: 3 });
    rejects('{"Hair":0,"Base64Image":["long"]}', 'MAX_STRING_LENGTH', {
      maxStringLength: 1,
    });
    const invalidImage = readChara('{"Hair":0,"Base64Image":42}');
    expect(invalidImage.issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_IMAGE_TYPE' }),
    );
  });

  it('caps issues, paths, and image metadata with an explicit truncation marker', () => {
    const fields = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [
        `x${i}${'a'.repeat(300)}`,
        { Base64Image: null },
      ]),
    );
    const doc = readChara(JSON.stringify({ Hair: 0, ...fields }), {
      maxIssues: 3,
    });
    expect(doc.issues).toHaveLength(3);
    expect(doc.issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    expect(doc.embeddedImages.length).toBeLessThanOrEqual(3);
    for (const issue of doc.issues) {
      expect(issue.path.join('.').length).toBeLessThanOrEqual(256);
      expect(issue.message.length).toBeLessThanOrEqual(256);
    }
  });

  it('uses fixed error messages without private excerpts', () => {
    try {
      readChara('{"Hair":0,"PRIVATE_CANARY":');
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE_CANARY');
      expect(error).toMatchObject({ code: 'INVALID_JSON' });
    }
  });

  it('performs no I/O while importing and reading', async () => {
    const spy = vi.fn(() => {
      throw new Error('Unexpected network');
    });
    vi.stubGlobal('fetch', spy);
    try {
      vi.resetModules();
      const api = await import('../src/index.js');
      api.readChara('{"Hair":0}');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    'anamnesis/full',
    'ktisis/full',
    'brio/extended',
    'partial/equipment',
    'partial/appearance',
  ])('reads reviewed synthetic fixture %s', (name) => {
    const text = readFileSync(
      new URL(`../../../fixtures/${name}.chara`, import.meta.url),
      'utf8',
    );
    expect(readChara(text).fields).toHaveProperty('TypeName');
  });
});
