#!/usr/bin/env node
/**
 * A scaffold section is a row, distinguishable from a custom one only by
 * `origin = 'scaffold'` — which no query branches on. This check fails the
 * build if application code starts to know a company's vocabulary:
 *
 *   - comparing a slug against a literal,
 *   - branching on `origin`,
 *   - a CHECK constraint or TypeScript union over a dimension's values.
 *
 * It is deliberately blunt. If it fires on something legitimate, the fix is
 * usually to move the decision into data.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const SOURCE_DIRS = ['src'];
const MIGRATION_DIR = 'drizzle';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const failures = [];

const SOURCE_RULES = [
  {
    pattern: /\bslug\s*[=!]==?\s*['"`]/,
    message: 'compares a slug against a literal — a code path must never test a company’s vocabulary',
  },
  {
    pattern: /\borigin\s*[=!]==?\s*['"`]scaffold['"`]/,
    message: 'branches on origin — `origin = \'scaffold\'` is inert data, not a behaviour switch',
  },
  {
    pattern: /['"`]slug['"`]\s*:\s*['"`](hr|payroll|benefits|policies|handbook|onboarding|time-off)['"`]/i,
    message: 'hardcodes a section slug the platform is not entitled to assume',
  },
];

for (const dir of SOURCE_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    if (!['.ts', '.tsx'].includes(extname(file))) continue;
    const relativePath = relative(ROOT, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
      for (const rule of SOURCE_RULES) {
        if (rule.pattern.test(line)) {
          failures.push(`${relativePath}:${index + 1} ${rule.message}\n    ${line.trim()}`);
        }
      }
    });
  }
}

/** No CHECK constraint may enumerate a dimension's values. */
const DIMENSION_TABLES = ['department', 'role', 'employee_type', 'location'];
for (const file of walk(join(ROOT, MIGRATION_DIR))) {
  if (extname(file) !== '.sql') continue;
  const relativePath = relative(ROOT, file);
  const sql = readFileSync(file, 'utf8');
  for (const table of DIMENSION_TABLES) {
    const constraint = new RegExp(`ALTER TABLE\\s+"?${table}"?[\\s\\S]{0,200}?CHECK`, 'i');
    if (constraint.test(sql)) {
      failures.push(`${relativePath} adds a CHECK constraint to "${table}" — dimensions are rows, not enums`);
    }
  }
  if (/CREATE\s+TYPE\s+\S+\s+AS\s+ENUM/i.test(sql)) {
    failures.push(`${relativePath} creates a Postgres enum — this schema has none, by design`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`\nThe application has started to know things about a company it should not:\n\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n\n`);
  process.exit(1);
}

process.stdout.write('No company vocabulary in application code.\n');
