/**
 * The PII set: personal contact details, hire dates and eligibility status
 * (spec §11). These are excluded from logs, audit diffs and error reports.
 *
 * Redaction is by key name, applied recursively, because audit diffs are
 * arbitrary row shapes and a positive list would rot as columns are added.
 */

const SENSITIVE_KEYS = new Set([
  'email',
  'contact_email',
  'contactEmail',
  'enquiries_email',
  'phone',
  'contact_phone',
  'contactPhone',
  'main_phone',
  'mainPhone',
  'extension',
  'street',
  'suite',
  'postal_code',
  'postalCode',
  'password',
  'password_hash',
  'passwordHash',
  'password_enc',
  'token',
  'token_hash',
  'tokenHash',
  'totp_secret_enc',
  'totpSecret',
  'secret',
  'date_of_birth',
  'dateOfBirth',
  'dob',
  'ssn',
  'national_id',
  'government_id',
  'pay',
  'salary',
  'compensation',
  'hire_date',
  'hireDate',
  'external_employee_id',
  'ip',
  'ip_hash',
]);

const REDACTED = '[redacted]';

export function redactPII<T>(value: T, depth = 0): unknown {
  if (depth > 12) return REDACTED;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactPII(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k) ? REDACTED : redactPII(v, depth + 1);
  }
  return out;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}
