import {createHash} from 'crypto';

// Keys whose values are session-local (lost on a server restart) or derived notes, not game content.
const VOLATILE_KEYS: ReadonlySet<string> = new Set(['warnings', 'canCancelAction']);

/** JSON with object keys sorted and volatile keys removed, so equal content gives equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (VOLATILE_KEYS.has(key) || child === undefined) {
        continue;
      }
      result[key] = canonicalize(child);
    }
    return result;
  }
  return value;
}

/** SHA-256 (hex) of the canonical JSON of `value`. */
export function fingerprintOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
