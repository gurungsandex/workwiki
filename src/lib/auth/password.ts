import { hash, verify } from '@node-rs/argon2';
import { loadArgon2Params } from '@/env';
import COMMON_PASSWORDS from './common-passwords.json' with { type: 'json' };

/**
 * Argon2id, with the parameters recorded in configuration so that a login can
 * rehash when an operator raises them. Minimum length over composition rules,
 * plus a breach-list check on set (spec §11).
 */

/** Argon2id. The enum in @node-rs/argon2 is ambient-const, so the value is named here. */
const ARGON2ID = 2;

function options() {
  const params = loadArgon2Params();
  return {
    algorithm: ARGON2ID,
    memoryCost: params.ARGON2_MEMORY_KIB,
    timeCost: params.ARGON2_TIME_COST,
    parallelism: params.ARGON2_PARALLELISM,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, options());
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, options());
  } catch {
    return false;
  }
}

/**
 * True when the stored hash was made with weaker parameters than are configured
 * now, so a successful login can quietly upgrade it. Reads the PHC string
 * rather than trusting a library helper, because the parameters are the point.
 */
export function passwordNeedsRehash(storedHash: string): boolean {
  const match = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
  if (!match) return true; // not argon2id at all, or unparseable: rehash it
  const [, version, memory, time, parallelism] = match as unknown as [string, string, string, string, string];
  if (Number(version) < 19) return true;
  const params = loadArgon2Params();
  return (
    Number(memory) < params.ARGON2_MEMORY_KIB ||
    Number(time) < params.ARGON2_TIME_COST ||
    Number(parallelism) < params.ARGON2_PARALLELISM
  );
}

export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 512;

const BREACHED = new Set((COMMON_PASSWORDS as string[]).map((p) => p.toLowerCase()));

export interface PasswordProblem {
  message: string;
}

/**
 * Returns the one sentence to show, or null. The messages say what to do,
 * never scold: composition rules are not enforced, length and breach are.
 */
export function checkPassword(password: string, context: { email?: string } = {}): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { message: `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you can remember is fine.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { message: `That is longer than ${MAX_PASSWORD_LENGTH} characters.` };
  }
  const lower = password.toLowerCase();
  if (BREACHED.has(lower)) {
    return { message: 'That password appears in known breach lists. Choose something else.' };
  }
  if (context.email && lower.includes(context.email.split('@')[0]!.toLowerCase()) && context.email.length > 3) {
    return { message: 'That password contains your email address. Choose something else.' };
  }
  return null;
}
