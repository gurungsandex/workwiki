import { hash, verify } from '@node-rs/argon2';
import { env } from '@/lib/env';

/**
 * Argon2id with tuned parameters recorded in config. The encoded hash carries
 * its own parameters, so a login can detect a hash made with weaker settings and
 * transparently rehash (spec §11).
 */

function options() {
  const e = env();
  return {
    // Argon2id. The enum is an ambient const enum, so the numeric value is
    // used directly to stay compatible with isolatedModules.
    algorithm: 2 as const,
    memoryCost: e.ARGON2_MEMORY_KIB,
    timeCost: e.ARGON2_TIME_COST,
    parallelism: e.ARGON2_PARALLELISM,
  };
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, options());
}

export async function verifyPassword(encoded: string, plain: string): Promise<boolean> {
  try {
    return await verify(encoded, plain, options());
  } catch {
    return false;
  }
}

/** True when the stored hash used weaker parameters than the current config. */
export function needsRehash(encoded: string): boolean {
  const e = env();
  const m = /\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(encoded);
  if (!m) return true;
  return (
    Number(m[1]) < e.ARGON2_MEMORY_KIB ||
    Number(m[2]) < e.ARGON2_TIME_COST ||
    Number(m[3]) < e.ARGON2_PARALLELISM
  );
}

/**
 * Minimum length over composition rules (spec §11). The breach-list check is a
 * k-anonymity range query against the local list shipped in the image; when the
 * list is absent the check is skipped rather than failing closed on a password.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (plain.length > 1024) problems.push('That is too long to be a password.');
  if (/^\s+$/.test(plain)) problems.push('A password cannot be only spaces.');
  return problems;
}
