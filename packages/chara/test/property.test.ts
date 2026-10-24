import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../src/index.js';
import { readChara } from '../src/index.js';

let seed = 0xabcdef;
function random(n: number) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
}
function value(depth: number): JsonValue {
  const kind = random(depth ? 7 : 5);
  if (kind === 0) return null;
  if (kind === 1) return Boolean(random(2));
  if (kind === 2) return random(10000) - 5000;
  if (kind === 3) return random(10000) / 1000;
  if (kind === 4)
    return (
      ['😀é', '\\"\n\u0000', '{}[]', 'constructor', '\ud800'][random(5)] ?? ''
    );
  if (kind === 5)
    return Array.from({ length: random(5) }, () => value(depth - 1));
  const record: Record<string, JsonValue> = Object.create(null);
  for (let i = 0; i < random(5); i++) record[`key${i}`] = value(depth - 1);
  return record;
}

const codeOf = (action: () => unknown): string | undefined => {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ name: 'CharaInputError' });
    return (error as { code: string }).code;
  }
  return undefined;
};

describe('deterministic JSON compatibility', () => {
  it('matches native JSON values for 2000 bounded synthetic documents', () => {
    for (let i = 0; i < 2000; i++) {
      const text = JSON.stringify({ Hair: 0, Future: value(5) });
      expect(readChara(text).fields).toEqual(JSON.parse(text));
    }
  });
  it('refuses malformed JSON with a reader error, and reads what is still valid, in 2000 seeded mutations', () => {
    let refused = 0;
    let accepted = 0;
    let notCharacter = 0;
    let duplicates = 0;
    for (let i = 0; i < 2000; i++) {
      const text = JSON.stringify({ Hair: 0, Future: value(3) });
      const pos = random(text.length);
      const mutated = `${text.slice(0, pos)}${['!', ',', ':', '\\', '\u0000'][random(5)]}${text.slice(pos + 1)}`;
      let parsed: unknown;
      let valid = true;
      try {
        parsed = JSON.parse(mutated);
      } catch {
        valid = false;
      }
      if (!valid) {
        // Malformed text is refused with the reader's own error, not by an accident.
        expect(
          codeOf(() => readChara(mutated)),
          mutated,
        ).toMatch(/^(INVALID_JSON|INVALID_NUMBER|DUPLICATE_KEY)$/);
        refused++;
        continue;
      }
      // Text native JSON accepts is read the same way, unless the mutation made it a document the
      // reader is right to refuse: no character field left, or a repeated key.
      const stillCharacter =
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        Object.hasOwn(parsed, 'Hair');
      const code = codeOf(() => readChara(mutated));
      if (code === undefined) {
        expect(readChara(mutated).fields, mutated).toEqual(parsed);
        accepted++;
      } else if (code === 'NOT_CHARACTER') {
        expect(stillCharacter, mutated).toBe(false);
        notCharacter++;
      } else {
        expect(code, mutated).toBe('DUPLICATE_KEY');
        expect(stillCharacter, mutated).toBe(true);
        duplicates++;
      }
    }
    // Both branches are exercised, so neither can be skipped without notice.
    expect(refused).toBeGreaterThan(1000);
    expect(accepted).toBeGreaterThan(300);
    expect(notCharacter).toBeGreaterThan(100);
    expect(refused + accepted + notCharacter + duplicates).toBe(2000);
  });
});
