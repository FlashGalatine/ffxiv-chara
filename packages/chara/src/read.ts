import { type CharaErrorCode, CharaInputError } from './errors.js';
import { CHARACTER_FIELDS, isRecord, KNOWN_FIELDS } from './field-spec.js';
import { boundedPath, IssueCollector } from './issues.js';
import { asBytes } from './realm.js';
import type {
  CharaDocument,
  EmbeddedImage,
  JsonRecord,
  JsonValue,
  ReadOptions,
} from './types.js';

export const READ_DEFAULTS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxDepth: 32,
  maxNodes: 100_000,
  maxKeyLength: 1024,
  maxStringLength: 65_536,
  maxIssues: 64,
});
export const READ_MAXIMUMS = Object.freeze({
  maxBytes: 64 * 1024 * 1024,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxKeyLength: 4096,
  maxStringLength: 1024 * 1024,
  maxIssues: 64,
});
type Limits = Required<ReadOptions>;
const fail = (code: CharaErrorCode): never => {
  throw new CharaInputError(code);
};

function limitsFrom(options: ReadOptions): Limits {
  if (!isRecord(options)) return fail('INVALID_OPTIONS');
  const result: Limits = { ...READ_DEFAULTS };
  for (const key of Object.keys(result) as (keyof Limits)[]) {
    if (!Object.hasOwn(options, key)) continue;
    const value = options[key];
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > READ_MAXIMUMS[key]
    )
      return fail('INVALID_OPTIONS');
    result[key] = value;
  }
  return result;
}

function admit(input: string | Uint8Array, maxBytes: number): string {
  if (typeof input !== 'string') {
    const bytes = asBytes(input);
    if (!bytes) return fail('INVALID_INPUT');
    if (bytes.byteLength > maxBytes) fail('INPUT_TOO_LARGE');
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      return fail('INVALID_UTF8');
    }
  }
  if (input.length > maxBytes) fail('INPUT_TOO_LARGE');
  let bytes = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      input.charCodeAt(i + 1) >= 0xdc00 &&
      input.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
    if (bytes > maxBytes) fail('INPUT_TOO_LARGE');
  }
  return input;
}

/** Depth-bounded descent: no complete object graph is constructed before admission. */
class Reader {
  private pos = 0;
  private nodes = 0;
  readonly images: EmbeddedImage[] = [];
  hasImage = false;
  readonly diagnostics: IssueCollector;
  constructor(
    private readonly text: string,
    private readonly limits: Limits,
    private readonly omitImages = true,
  ) {
    this.diagnostics = new IssueCollector(limits.maxIssues);
  }
  read(): JsonValue {
    if (this.text.charCodeAt(0) === 0xfeff) this.pos++;
    const value = this.value(1, [], false);
    this.whitespace();
    if (this.pos !== this.text.length) fail('INVALID_JSON');
    return value;
  }
  private whitespace(): void {
    while (
      this.pos < this.text.length &&
      ' \t\r\n'.includes(this.text[this.pos] as string)
    )
      this.pos++;
  }
  private node(): void {
    if (++this.nodes > this.limits.maxNodes) fail('MAX_NODES');
  }
  private take(char: string): void {
    this.whitespace();
    if (this.text[this.pos++] !== char) fail('INVALID_JSON');
  }
  private string(
    limit: number,
    discard: boolean,
    code: CharaErrorCode,
  ): string {
    const start = this.pos;
    if (this.text[this.pos++] !== '"') return fail('INVALID_JSON');
    let length = 0;
    while (this.pos < this.text.length) {
      const char = this.text.charCodeAt(this.pos++);
      if (char === 34) {
        if (discard) return '';
        // Native parsing sees only an admitted scalar, never a graph or image payload.
        try {
          return JSON.parse(this.text.slice(start, this.pos)) as string;
        } catch {
          return fail('INVALID_JSON');
        }
      }
      if (char < 32) fail('INVALID_JSON');
      if (char === 92) {
        const escaped = this.text[this.pos++];
        if (escaped === 'u') {
          for (let i = 0; i < 4; i++) {
            const digit = this.text.charCodeAt(this.pos++);
            if (
              !(
                (digit >= 48 && digit <= 57) ||
                (digit >= 65 && digit <= 70) ||
                (digit >= 97 && digit <= 102)
              )
            )
              fail('INVALID_JSON');
          }
        } else if (escaped === undefined || !'"\\/bfnrt'.includes(escaped))
          fail('INVALID_JSON');
      }
      if (++length > limit) fail(code);
    }
    return fail('INVALID_JSON');
  }
  private value(
    depth: number,
    path: (string | number)[],
    discard: boolean,
    imageString = false,
  ): JsonValue {
    if (depth > this.limits.maxDepth) fail('MAX_DEPTH');
    this.node();
    this.whitespace();
    const char = this.text[this.pos];
    if (char === '"')
      return this.string(
        imageString ? Infinity : this.limits.maxStringLength,
        discard,
        'MAX_STRING_LENGTH',
      );
    if (char === '{') return this.object(depth, path, discard);
    if (char === '[') return this.array(depth, path, discard);
    for (const [token, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (this.text.startsWith(token, this.pos)) {
        this.pos += token.length;
        return value;
      }
    }
    const start = this.pos;
    if (char === '-') this.pos++;
    if (this.text[this.pos] === '0') this.pos++;
    else {
      if (!this.digit(false)) return fail('INVALID_JSON');
      while (this.digit()) this.pos++;
    }
    if (this.text[this.pos] === '.') {
      this.pos++;
      if (!this.digit()) fail('INVALID_JSON');
      while (this.digit()) this.pos++;
    }
    if (this.text[this.pos] === 'e' || this.text[this.pos] === 'E') {
      this.pos++;
      if (this.text[this.pos] === '-' || this.text[this.pos] === '+')
        this.pos++;
      if (!this.digit()) fail('INVALID_JSON');
      while (this.digit()) this.pos++;
    }
    const number = Number(this.text.slice(start, this.pos));
    if (
      !Number.isFinite(number) ||
      (Number.isInteger(number) && !Number.isSafeInteger(number))
    )
      fail('INVALID_NUMBER');
    return number;
  }
  private digit(allowZero = true): boolean {
    const code = this.text.charCodeAt(this.pos);
    return code >= (allowZero ? 48 : 49) && code <= 57;
  }
  private object(
    depth: number,
    path: (string | number)[],
    discard: boolean,
  ): JsonValue {
    this.pos++;
    const result: JsonRecord | null = discard ? null : Object.create(null);
    const keys = new Set<string>();
    this.whitespace();
    if (this.text[this.pos] === '}') {
      this.pos++;
      return result;
    }
    while (true) {
      this.whitespace();
      const key = this.string(
        this.limits.maxKeyLength,
        false,
        'MAX_KEY_LENGTH',
      );
      this.node();
      if (keys.has(key)) fail('DUPLICATE_KEY');
      keys.add(key);
      this.take(':');
      this.whitespace();
      const childPath = boundedPath([...path, key]);
      const image = this.omitImages && key.toLowerCase() === 'base64image';
      if (image && !discard) {
        this.hasImage = true;
        const initial = this.text[this.pos];
        const type =
          initial === '"'
            ? 'string'
            : initial === '{'
              ? 'object'
              : initial === '['
                ? 'array'
                : initial === 'n'
                  ? 'null'
                  : initial === 't' || initial === 'f'
                    ? 'boolean'
                    : 'number';
        if (this.images.length < this.limits.maxIssues)
          this.images.push({ path: childPath, type });
        this.diagnostics.add(
          type === 'string' || type === 'null'
            ? 'IMAGE_OMITTED'
            : 'INVALID_IMAGE_TYPE',
          childPath,
          'Embedded image field omitted.',
          type === 'string' || type === 'null' ? 'info' : 'warning',
        );
      }
      const value = this.value(depth + 1, childPath, discard || image, image);
      if (result && !image) result[key] = value;
      this.whitespace();
      if (this.text[this.pos] === '}') {
        this.pos++;
        return result;
      }
      this.take(',');
    }
  }
  private array(
    depth: number,
    path: (string | number)[],
    discard: boolean,
  ): JsonValue {
    this.pos++;
    const result: JsonValue[] | null = discard ? null : [];
    let index = 0;
    this.whitespace();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return result;
    }
    while (true) {
      const value = this.value(
        depth + 1,
        boundedPath([...path, index++]),
        discard,
      );
      result?.push(value);
      this.whitespace();
      if (this.text[this.pos] === ']') {
        this.pos++;
        return result;
      }
      this.take(',');
    }
  }
}

/** Internal transport parser: structural admission without character/image policy. */
export function readBoundedJson(input: Uint8Array): JsonValue {
  return new Reader(admit(input, 2 * 1024 * 1024), READ_DEFAULTS, false).read();
}

export function readChara(
  input: string | Uint8Array,
  options: ReadOptions = {},
): CharaDocument {
  const limits = limitsFrom(options);
  const reader = new Reader(admit(input, limits.maxBytes), limits);
  const fields = reader.read();
  if (
    !isRecord(fields) ||
    !Object.keys(fields).some((key) => CHARACTER_FIELDS.has(key))
  )
    return fail('NOT_CHARACTER');
  for (const key of Object.keys(fields)) {
    if (!KNOWN_FIELDS.has(key))
      reader.diagnostics.add(
        'UNSUPPORTED_FIELD',
        [key],
        'Stored field has no supported interpretation.',
      );
  }
  return {
    fields,
    hasEmbeddedImage: reader.hasImage,
    embeddedImages: reader.images,
    issues: reader.diagnostics.issues,
  };
}
