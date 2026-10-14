import {createHash} from 'crypto';

// Keys whose values are session-local (lost on a server restart) or derived notes, not game content.
const VOLATILE_KEYS: ReadonlySet<string> = new Set(['warnings', 'canCancelAction']);

/**
 * JSON with object keys sorted and `undefined` removed, so equal content gives equal text.
 *
 * Volatile keys are removed too, unless `keepVolatile` (advisory fingerprint).
 */
export function canonicalJson(value: unknown, keepVolatile: boolean = false): string {
  return JSON.stringify(canonicalize(value, keepVolatile));
}

function canonicalize(value: unknown, keepVolatile: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, keepVolatile));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if ((!keepVolatile && VOLATILE_KEYS.has(key)) || child === undefined) {
        continue;
      }
      result[key] = canonicalize(child, keepVolatile);
    }
    return result;
  }
  return value;
}

/** SHA-256 (hex) of the canonical JSON of `value`, without volatile keys (stable content id). */
export function fingerprintOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** SHA-256 (hex) of the canonical JSON of `value`, volatile keys included (advice change detection). */
export function advisoryFingerprintOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value, true)).digest('hex');
}
