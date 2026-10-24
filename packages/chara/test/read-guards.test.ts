import { describe, expect, it } from 'vitest';
import { boundedPath, IssueCollector } from '../src/issues.js';
import { READ_DEFAULTS, READ_MAXIMUMS, readChara } from '../src/read.js';

// Each guard below has a test that fails when the guard is removed or loosened: the reader's own
// string checks on the image subtree it discards, the budgets inside that subtree, the ceilings,
// the number grammar and the path and issue budgets.

function rejects(input: string, code: string | string[], options?: object) {
  const codes = Array.isArray(code) ? code : [code];
  try {
    readChara(input, options);
  } catch (error) {
    expect(error).toMatchObject({ name: 'CharaInputError' });
    expect(codes).toContain((error as { code: string }).code);
    return;
  }
  throw new Error(`Expected a rejection with ${codes.join(' or ')}: ${input}`);
}
const image = (value: string, sibling = '') =>
  `{"Hair":0,"Base64Image":${value}${sibling}}`;

describe('the image string that is discarded before native parsing', () => {
  it('rejects a raw control character, which JSON forbids inside a string', () => {
    for (const raw of ['\n', '\t', '\r', '\u0000', '\u0001', '\u001f'])
      rejects(image(`"ab${raw}cd"`), 'INVALID_JSON');
  });
  it('allows the first character above the control range and the DEL character', () => {
    expect(readChara(image('"a b\u007féあ"')).hasEmbeddedImage).toBe(true);
  });
  it('rejects an escape that JSON does not define', () => {
    for (const bad of ['q', 'x', 'a', '0', "'", ' ', 'U'])
      rejects(image(`"ab\\${bad}cd"`), 'INVALID_JSON');
  });
  it('accepts every escape that JSON defines', () => {
    for (const sequence of [
      '\\"',
      '\\\\',
      '\\/',
      '\\b',
      '\\f',
      '\\n',
      '\\r',
      '\\t',
    ])
      expect(
        readChara(image(`"ab${sequence}cd"`, ',"Tribe":"Xaela"')).fields,
      ).toMatchObject({ Tribe: 'Xaela' });
  });
  it('requires four hexadecimal digits after \\u, checking each position', () => {
    for (const bad of ['G123', '1G23', '12G3', '123G', 'ZZZZ', '', '12"}'])
      rejects(image(`"ab\\u${bad}cd"`), 'INVALID_JSON');
    // The characters on either side of each accepted range.
    for (const edge of ['/', ':', '@', 'G', '`', 'g'])
      rejects(image(`"\\u000${edge}"`), 'INVALID_JSON');
    for (const ok of ['0000', 'ffff', 'FFFF', 'AbCd', '09af', '09AF', '00e9'])
      expect(readChara(image(`"\\u${ok}"`)).hasEmbeddedImage).toBe(true);
  });
  it('rejects an unterminated string anywhere, including as the whole document', () => {
    rejects('"abc', 'INVALID_JSON');
    rejects('{"Hair":0,"x":"abc', 'INVALID_JSON');
  });
  it('rejects an unterminated string and a backslash at the end', () => {
    rejects(image('"abc'), 'INVALID_JSON');
    rejects('{"Hair":0,"Base64Image":"abc\\', 'INVALID_JSON');
  });
  it('refuses every printable character that does not start a defined escape', () => {
    // 0x20 to 0x7e, except the nine that JSON defines after a backslash: " \ / b f n r t u.
    const defined = new Set([
      '"',
      String.fromCharCode(92),
      '/',
      'b',
      'f',
      'n',
      'r',
      't',
      'u',
    ]);
    let tried = 0;
    for (let code = 0x20; code <= 0x7e; code++) {
      const char = String.fromCharCode(code);
      if (defined.has(char)) continue;
      tried++;
      rejects(image(`"a\\${char}b"`), 'INVALID_JSON');
    }
    expect(tried).toBe(0x7e - 0x20 + 1 - 9);
  });
  it('applies the same checks to strings nested inside the discarded value', () => {
    for (const nested of [
      '{"a":"bad\\qescape"}',
      '["bad\\uZZZZ"]',
      '{"a":["x","raw\ttab"]}',
      '[{"deep":{"deeper":"raw\nline"}}]',
    ])
      rejects(image(nested), 'INVALID_JSON');
  });
  it('accepts a valid escaped image and reads the sibling keys on both sides of it', () => {
    const text = `{"Hair":3,"Base64Image":"iVBOR\\n\\u00e9\\"x\\/\\\\","Tribe":"Xaela"}`;
    const document = readChara(text);
    expect(document.fields).toEqual({ Hair: 3, Tribe: 'Xaela' });
    expect(document.embeddedImages).toEqual([
      { path: ['Base64Image'], type: 'string' },
    ]);
    expect(document.issues.map((issue) => issue.code)).toEqual([
      'IMAGE_OMITTED',
    ]);
  });
  it('has no length limit of its own, unlike any other string', () => {
    const long = 'A'.repeat(READ_DEFAULTS.maxStringLength + 1000);
    expect(readChara(image(`"${long}"`)).hasEmbeddedImage).toBe(true);
    rejects(`{"Hair":0,"Other":"${long}"}`, 'MAX_STRING_LENGTH');
  });
  it('exempts only the string right under the key, not strings nested in an object or array image', () => {
    rejects('{"Hair":0,"Base64Image":{"a":"long"}}', 'MAX_STRING_LENGTH', {
      maxStringLength: 1,
    });
    rejects(
      '{"Hair":0,"Base64Image":{"a":{"b":"long"}}}',
      'MAX_STRING_LENGTH',
      {
        maxStringLength: 1,
      },
    );
    rejects('{"Hair":0,"Base64Image":["long"]}', 'MAX_STRING_LENGTH', {
      maxStringLength: 1,
    });
    expect(
      readChara('{"Hair":0,"Base64Image":"long"}', { maxStringLength: 1 })
        .hasEmbeddedImage,
    ).toBe(true);
  });
  it('still matches the key under any capitalisation', () => {
    expect(readChara('{"Hair":0,"BASE64IMAGE":"x"}').hasEmbeddedImage).toBe(
      true,
    );
    rejects('{"Hair":0,"base64image":"bad\\q"}', 'INVALID_JSON');
  });
});

describe('the budgets inside the discarded image subtree', () => {
  // Nodes counted: the root, then one per key and one per value.
  const nodes = (inside: number) => 1 + 2 + 2 + inside;
  it('counts the elements of a wide array', () => {
    const text = image(`[${Array.from({ length: 20 }, () => '0').join(',')}]`);
    expect(readChara(text, { maxNodes: nodes(20) }).hasEmbeddedImage).toBe(
      true,
    );
    rejects(text, 'MAX_NODES', { maxNodes: nodes(20) - 1 });
  });
  it('counts the keys and values of an object', () => {
    const keys = Array.from({ length: 30 }, (_, i) => `"k${i}":0`).join(',');
    const text = image(`{${keys}}`);
    expect(readChara(text, { maxNodes: nodes(60) }).hasEmbeddedImage).toBe(
      true,
    );
    rejects(text, 'MAX_NODES', { maxNodes: nodes(60) - 1 });
  });
  it('counts nested containers', () => {
    const text = image('[[0,0],[0,0]]');
    expect(readChara(text, { maxNodes: nodes(6) }).hasEmbeddedImage).toBe(true);
    rejects(text, 'MAX_NODES', { maxNodes: nodes(6) - 1 });
  });
  it('measures a key against maxKeyLength (the key "Base64Image" itself has 11 characters)', () => {
    const text = image('{"abcdefghijkl":0}');
    expect(readChara(text, { maxKeyLength: 12 }).hasEmbeddedImage).toBe(true);
    rejects(text, 'MAX_KEY_LENGTH', { maxKeyLength: 11 });
  });
  it('measures depth below the image as well', () => {
    // root 1, Base64Image value 2, then one more per nested array.
    const text = image(`${'['.repeat(4)}${']'.repeat(4)}`);
    expect(readChara(text, { maxDepth: 5 }).hasEmbeddedImage).toBe(true);
    rejects(text, 'MAX_DEPTH', { maxDepth: 4 });
  });
  it('rejects a duplicate key inside the subtree', () => {
    rejects(image('{"a":0,"a":1}'), 'DUPLICATE_KEY');
    rejects(image('[{"a":0,"a":1}]'), 'DUPLICATE_KEY');
  });
  it('records an object or array image as an invalid type, and still checks its content', () => {
    const document = readChara(image('{"a":[1,2]}'));
    expect(document.embeddedImages).toEqual([
      { path: ['Base64Image'], type: 'object' },
    ]);
    expect(document.issues.map((issue) => issue.code)).toEqual([
      'INVALID_IMAGE_TYPE',
    ]);
    expect(Object.hasOwn(document.fields, 'Base64Image')).toBe(false);
  });
});

describe('the host ceilings', () => {
  // Hard-coded, so that a change to the constants has to change this file too. They are the
  // values documented in docs/api.md.
  const CEILINGS = {
    maxBytes: 64 * 1024 * 1024,
    maxDepth: 128,
    maxNodes: 1_000_000,
    maxKeyLength: 4096,
    maxStringLength: 1024 * 1024,
    maxIssues: 64,
  };
  const DEFAULTS = {
    maxBytes: 8 * 1024 * 1024,
    maxDepth: 32,
    maxNodes: 100_000,
    maxKeyLength: 1024,
    maxStringLength: 65_536,
    maxIssues: 64,
  };
  it('are exactly the documented values, and defaults stay under them', () => {
    expect({ ...READ_MAXIMUMS }).toEqual(CEILINGS);
    expect({ ...READ_DEFAULTS }).toEqual(DEFAULTS);
    expect(Object.isFrozen(READ_MAXIMUMS)).toBe(true);
    expect(Object.isFrozen(READ_DEFAULTS)).toBe(true);
  });
  for (const [key, ceiling] of Object.entries(CEILINGS))
    it(`accept ${key} at ${ceiling} and refuse one more`, () => {
      expect(readChara('{"Hair":0}', { [key]: ceiling }).fields).toEqual({
        Hair: 0,
      });
      rejects('{"Hair":0}', 'INVALID_OPTIONS', { [key]: ceiling + 1 });
    });
  it('accept 1 for each limit, and let the reader apply it', () => {
    rejects('{"Hair":0}', 'INPUT_TOO_LARGE', { maxBytes: 1 });
    rejects('{"Hair":0}', 'MAX_DEPTH', { maxDepth: 1 });
    rejects('{"Hair":0}', 'MAX_NODES', { maxNodes: 1 });
    rejects('{"Hair":0}', 'MAX_KEY_LENGTH', { maxKeyLength: 1 });
    rejects('{"Hair":0,"x":"ab"}', 'MAX_STRING_LENGTH', { maxStringLength: 1 });
    expect(readChara('{"Hair":0}', { maxIssues: 1 }).fields).toEqual({
      Hair: 0,
    });
  });
  it('really allow a document at the depth ceiling and refuse one level deeper', () => {
    const nest = (levels: number) =>
      `{"Hair":0,"x":${'['.repeat(levels)}${']'.repeat(levels)}}`;
    // root is depth 1, so the value under "x" starts at depth 2.
    expect(readChara(nest(127), { maxDepth: 128 }).hasEmbeddedImage).toBe(
      false,
    );
    rejects(nest(128), 'MAX_DEPTH', { maxDepth: 128 });
  });
  it('use the defaults when no option is given and an empty object is allowed', () => {
    const nest = (levels: number) =>
      `{"Hair":0,"x":${'['.repeat(levels)}${']'.repeat(levels)}}`;
    expect(readChara(nest(31)).fields).toHaveProperty('x');
    rejects(nest(32), 'MAX_DEPTH');
    expect(readChara('{"Hair":0}', {}).fields).toEqual({ Hair: 0 });
  });
});

describe('the number grammar', () => {
  const field = (token: string) => `{"Hair":0,"x":${token}}`;
  it('accepts the JSON number forms, including exponents and the safe integer bounds', () => {
    for (const [token, value] of [
      ['0', 0],
      ['-0', -0],
      ['1E+2', 100],
      ['1e2', 100],
      ['1E2', 100],
      ['25e-1', 2.5],
      ['0.5', 0.5],
      ['-0.5e+1', -5],
      ['0e0', 0],
      ['9007199254740991', Number.MAX_SAFE_INTEGER],
      ['-9007199254740991', -Number.MAX_SAFE_INTEGER],
    ] as const)
      expect(readChara(field(token)).fields.x, token).toBe(value);
  });
  it('rejects unsafe integers, including ones written with a fraction or exponent', () => {
    for (const token of [
      '9007199254740992',
      '-9007199254740992',
      '9007199254740992.0',
      '90071992547409920e-1',
      '1e999',
      '-1e999',
    ])
      rejects(field(token), 'INVALID_NUMBER');
  });
  it('rejects tokens that are not JSON numbers', () => {
    for (const token of [
      '1.',
      '-',
      '--1',
      '1.e2',
      '.5',
      '01',
      '-01',
      '00',
      '+1',
      '1e',
      '1e+',
      '1e-',
      '0x10',
      'NaN',
      'Infinity',
      '-Infinity',
      '1_000',
      '1,5',
    ])
      rejects(field(token), 'INVALID_JSON');
  });
});

describe('the key length limit', () => {
  it('accepts a key of exactly maxKeyLength characters and rejects one more', () => {
    for (const length of [1, 5, 64]) {
      const key = 'k'.repeat(length);
      const text = `{"Hair":0,"${key}":1}`;
      expect(
        readChara(text, { maxKeyLength: Math.max(length, 4) }).fields,
      ).toHaveProperty(key);
      if (length > 4)
        rejects(text, 'MAX_KEY_LENGTH', { maxKeyLength: length - 1 });
    }
  });
  it('counts an escape as one character', () => {
    expect(
      readChara('{"Hair":0,"\\u0061\\u0062":1}', { maxKeyLength: 4 }).fields,
    ).toHaveProperty('ab');
    rejects('{"Hair":0,"\\u0061bcdef":1}', 'MAX_KEY_LENGTH', {
      maxKeyLength: 5,
    });
  });
});

describe('the budget for a diagnostic path', () => {
  const total = (path: (string | number)[]) =>
    path.reduce<number>(
      (sum, part, i) => sum + String(part).length + (i ? 1 : 0),
      0,
    );
  it('keeps a path of several long segments within 256 characters, shortening the last', () => {
    const path = boundedPath([
      'a'.repeat(100),
      'b'.repeat(100),
      'c'.repeat(100),
      'Base64Image',
    ]);
    expect(path.map((part) => String(part).length)).toEqual([100, 100, 54]);
    expect(String(path[2])).toBe(`${'c'.repeat(53)}…`);
    expect(total(path)).toBe(256);
  });
  it('counts the separator between segments', () => {
    // 254 + 1 separator leaves room for one character, so the second segment becomes a bare ellipsis.
    const path = boundedPath(['a'.repeat(254), 'b'.repeat(10)]);
    expect(total(path)).toBeLessThanOrEqual(256);
    expect(path).toHaveLength(2);
    expect(String(path[1]).endsWith('…')).toBe(true);
  });
  it('never exceeds the budget when the prefix leaves room for only the separator', () => {
    // The audit notes the following segments are then dropped without an ellipsis; only the bound
    // is documented (docs/api.md), so that is all that is pinned.
    const path = boundedPath(['a'.repeat(255), 'b'.repeat(40), 'c']);
    expect(path[0]).toBe('a'.repeat(255));
    expect(total(path)).toBeLessThanOrEqual(256);
  });
  it('bounds the path of a diagnostic for a long top-level key, in the collector itself', () => {
    const key = 'u'.repeat(1000);
    const issue = readChara(`{"Hair":0,"${key}":1}`).issues[0];
    expect(issue).toMatchObject({ code: 'UNSUPPORTED_FIELD' });
    expect(issue?.path).toEqual([`${'u'.repeat(255)}…`]);
    expect(total(issue?.path ?? [])).toBe(256);
    const direct = new IssueCollector();
    direct.add('X', ['a'.repeat(300)], 'm');
    expect(direct.issues[0]?.path).toEqual([`${'a'.repeat(255)}…`]);
  });
  it('keeps short paths unchanged, numbers included', () => {
    expect(boundedPath(['Body', 'Dye', 3])).toEqual(['Body', 'Dye', 3]);
    expect(boundedPath([])).toEqual([]);
  });
  it('is applied to the path of an image found below nested long keys, in the issue and in the image metadata', () => {
    const key = (c: string) => c.repeat(100);
    const text = `{"Hair":0,"${key('a')}":{"${key('b')}":{"${key('c')}":{"Base64Image":"x"}}}}`;
    const document = readChara(text, { maxKeyLength: 100 });
    const issue = document.issues.find(
      (entry) => entry.code === 'IMAGE_OMITTED',
    );
    const expected = [key('a'), key('b'), `${'c'.repeat(53)}…`];
    expect(issue?.path).toEqual(expected);
    // The reader bounds embeddedImages itself; the collector only bounds the issue.
    expect(document.embeddedImages).toEqual([
      { path: expected, type: 'string' },
    ]);
    expect(total(document.embeddedImages[0]?.path ?? [])).toBe(256);
  });
});

describe('the issue cap', () => {
  const fill = (count: number) => {
    const collector = new IssueCollector();
    for (let i = 0; i < count; i++)
      collector.add(`CODE_${i}`, ['x', i], 'message');
    return collector.issues;
  };
  it('keeps every issue up to and including the cap, with no marker', () => {
    const issues = fill(64);
    expect(issues).toHaveLength(64);
    expect(issues.map((issue) => issue.code)).toEqual(
      Array.from({ length: 64 }, (_, i) => `CODE_${i}`),
    );
  });
  it('turns the last entry into the truncation marker on the first one over', () => {
    const issues = fill(65);
    expect(issues).toHaveLength(64);
    expect(issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    expect(issues.slice(0, 63).map((issue) => issue.code)).toEqual(
      Array.from({ length: 63 }, (_, i) => `CODE_${i}`),
    );
    expect(fill(200)).toEqual(issues);
  });
  it('honours a smaller cap given to the reader', () => {
    const text = `{"Hair":0,${Array.from({ length: 10 }, (_, i) => `"Unknown${i}":1`).join(',')}}`;
    const issues = readChara(text, { maxIssues: 4 }).issues;
    expect(issues).toHaveLength(4);
    expect(issues.at(-1)?.code).toBe('ISSUES_TRUNCATED');
    expect(issues.slice(0, 3).map((issue) => issue.path)).toEqual([
      ['Unknown0'],
      ['Unknown1'],
      ['Unknown2'],
    ]);
  });
});
