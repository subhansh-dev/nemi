import crypto from 'node:crypto';

/**
 * Constant-time string comparison. Both sides are hashed first so the
 * comparison never depends on input length (a raw timingSafeEqual throws on
 * unequal buffer sizes, which would itself leak length information).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const da = crypto.createHash('sha256').update(a, 'utf8').digest();
  const db = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}
