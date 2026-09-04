import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

/**
 * The invariants, checked mechanically.
 *
 * CLAUDE.md says these must survive every future session. A prose reminder does
 * not survive; a build failure does.
 */

type Finding = { rule: string; file: string; line: number; text: string };

const ROOTS = ['app', 'lib', 'components', 'worker', 'scripts'];
const CODE = new Set(['.ts', '.tsx']);

const RULES: {
  name: string;
  test: RegExp;
  why: string;
  appliesTo?: (path: string) => boolean;
}[] = [
  {
    name: 'no-derived-columns',
    test: /\b(status|progress|percent_complete|completion|coverage)\s*(?:=|:)\s*(?:count|sum|round|\d+\s*\/)/i,
    why: 'Counts, coverage and progress are computed at read time, never stored.',
  },
  {
    name: 'no-hard-delete-of-content',
    test: /DELETE\s+FROM\s+(content_node|block|contact_card|file_object|employee_profile|app_user)\b/i,
    why: 'Deletes are soft: archived_at plus a restore path. Purge lives in lib/content/archive.ts only.',
    appliesTo: (p) => !p.includes('lib/content/archive.ts') && !p.includes('scripts/check-invariants.ts'),
  },
  {
    name: 'no-audit-mutation',
    test: /(UPDATE\s+audit_event|DELETE\s+FROM\s+audit_event)/i,
    why: 'The audit log is append-only.',
    appliesTo: (p) => !p.includes('scripts/check-invariants.ts'),
  },
  {
    name: 'no-motion',
    test: /(transition\s*:(?!\s*none)|animation\s*:(?!\s*none)|@keyframes)/i,
    why: 'Broadsheet has no transitions, no motion and no animation.',
  },
  {
    name: 'no-sans-serif',
    test: /font-family\s*:\s*[^;]*\b(sans-serif|Helvetica|Arial|Inter|Roboto|system-ui)\b/i,
    why: 'One typeface, including UI chrome. No sans-serif.',
    appliesTo: (p) => !p.includes('styles/broadsheet.css'),
  },
  {
    name: 'access-rules-read-in-one-place',
    test: /FROM\s+access_rule\b/i,
    why:
      'Only lib/access/ may read access_rule to DECIDE access; call evaluate(). ' +
      'Admin screens that merely list or count rules are exempt and named below.',
    // Admin surfaces display rules; they do not evaluate them. Employee-facing
    // read paths (lib/content, lib/search, app/api) are NOT exempt.
    appliesTo: (p) =>
      !p.startsWith('lib/access/') &&
      !p.includes('check-invariants') &&
      !p.includes('app/(admin)/') &&
      !p.includes('lib/setup/checklist.ts'),
  },
];

/**
 * Company vocabulary must never be a literal in code. A section slug in an if
 * is how "content-agnostic" quietly stops being true.
 */
const SLUG_LITERALS =
  /['"`](?:code-of-conduct|time-off|sick-leave|parental-leave|retirement|payroll|human-resources|engineering|nursing|field-operations)['"`]/i;

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      yield* walk(full);
    } else if (CODE.has(extname(e.name)) || extname(e.name) === '.css') {
      yield full;
    }
  }
}

async function main() {
  const findings: Finding[] = [];

  for (const root of ROOTS.concat(['styles'])) {
    for await (const file of walk(root)) {
      const src = await readFile(file, 'utf8');
      const lines = src.split('\n');

      // The checker's own rule table describes the patterns it hunts for.
      // `continue`, not `return`: returning here would abandon the whole scan
      // and report success, which is the worst possible failure mode for this.
      if (file.includes('check-invariants')) continue;

      lines.forEach((text, i) => {
        // Comments may discuss a rule; code may not break it.
        const stripped = text.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (!stripped.trim()) return;

        for (const rule of RULES) {
          if (rule.appliesTo && !rule.appliesTo(file)) continue;
          if (rule.test.test(stripped)) {
            findings.push({ rule: rule.name, file, line: i + 1, text: text.trim() });
          }
        }
        if (SLUG_LITERALS.test(stripped)) {
          findings.push({
            rule: 'no-company-vocabulary-in-code',
            file,
            line: i + 1,
            text: text.trim(),
          });
        }
      });
    }
  }

  if (findings.length === 0) {
    process.stdout.write('Invariants hold.\n');
    return;
  }

  process.stderr.write('\nInvariant violations:\n\n');
  for (const f of findings) {
    const why = RULES.find((r) => r.name === f.rule)?.why ?? 'Company vocabulary must not be a literal in code.';
    process.stderr.write(`  ${f.rule}\n    ${f.file}:${f.line}\n    ${f.text.slice(0, 110)}\n    ${why}\n\n`);
  }
  process.exit(1);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
