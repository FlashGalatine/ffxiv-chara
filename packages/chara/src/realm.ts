// Checks that do not depend on which JavaScript realm created a value: a typed array from an
// iframe, a vm context or a test environment fails `instanceof` against this realm's constructors.

const typedArray = Object.getPrototypeOf(Uint8Array.prototype) as object;
const getter = (key: PropertyKey) =>
  Object.getOwnPropertyDescriptor(typedArray, key)?.get;
// These getters read internal slots, so unlike a property lookup they cannot be shadowed by the
// instance, and they work on a typed array of any realm.
const tagOf = getter(Symbol.toStringTag);
const bufferOf = getter('buffer');
const offsetOf = getter('byteOffset');
const lengthOf = getter('byteLength');

/**
 * A Uint8Array view of this realm over the same memory when `value` is a real Uint8Array of any
 * realm, else null (also for a view whose buffer was detached). The tag getter unlike
 * `instanceof` works across realms and unlike `Object.prototype.toString` cannot be faked.
 */
export function asBytes(value: unknown): Uint8Array | null {
  if (!tagOf || !bufferOf || !offsetOf || !lengthOf) return null;
  if (tagOf.call(value) !== 'Uint8Array') return null;
  try {
    return new Uint8Array(
      bufferOf.call(value),
      offsetOf.call(value),
      lengthOf.call(value),
    );
  } catch {
    return null;
  }
}

/** The members of an AbortSignal that this library uses, whichever realm or polyfill made it. */
export function isAbortSignalLike(value: unknown): value is AbortSignal {
  if (typeof value !== 'object' || value === null) return false;
  const signal = value as Partial<AbortSignal>;
  return (
    typeof signal.aborted === 'boolean' &&
    typeof signal.addEventListener === 'function' &&
    typeof signal.removeEventListener === 'function'
  );
}
