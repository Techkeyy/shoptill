import { Address } from '@ton/core';

/** Raw form "wc:HEX" (uppercase); falls back to trimmed uppercase input if unparsable. */
export function normalizeAddress(a: string): string {
  try {
    return Address.parse(a.trim()).toRawString().toUpperCase();
  } catch {
    return a.trim().toUpperCase();
  }
}
