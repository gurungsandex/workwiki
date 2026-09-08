import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { csrfToken } from '@/lib/csrf';
import { db } from '@/db/client';
import { accessRules, departments, employeeProfiles, employeeTypes, locations, pages, roles, sections, topics, users } from '@/db/schema';
import { loadVocabulary } from '@/lib/access/vocabulary';
import { lockedExplainer, ruleSentence } from '@/lib/access/sentence';
import type { Conditions, Effect } from '@/lib/access/types';
import { ActionForm } from '@/components/action-form';
import { MiniForm } from '@/components/mini-form';
import { explainForPerson, matchCount, removeRule, saveRule } from './actions';
import { RuleBuilder } from '@/components/rule-builder';

export const dynamic = 'force-dynamic';

/** How it resolves, and why — the same table the design publishes. */
const TRUTH_TABLE: [string, string, string][] = [
  ['No rule on the page', 'Inherits its section', 'Whatever the section allows — never more'],
  ['Two allow rules', 'Either one matching is enough', 'Access, with the matching rule named in preview'],
  ['An explicit deny', 'Beats every allow, at any level', 'Nothing — the page is not routable for them'],
  [
    'Everything matches but tenure',
    'Locked, not denied',
    'Title, unlock date and a one-line teaser. Knowing what is coming is the point',
  ],
  ['Parent is narrower than the child', 'The parent wins', 'Access narrows down the tree; a child can never widen it'],
];

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  await requireAdmin();
  const { target } = await searchParams;
  const csrf = await csrfToken();

  const [vocabulary, pageRows, sectionRows, topicRows, ruleRows, people, depts, roleRows, types, sites] =
    await Promise.all([
      loadVocabulary(),
      db
        .select({ id: pages.id, title: pages.title, topicTitle: topics.title, sectionTitle: sections.title })
        .from(pages)
        .innerJoin(topics, eq(topics.id, pages.topicId))
        .innerJoin(sections, eq(sections.id, topics.sectionId))
        .where(isNull(pages.archivedAt))
        .orderBy(asc(sections.sortKey), asc(topics.sortKey), asc(pages.sortKey)),
      db.select({ id: sections.id, title: sections.title }).from(sections).where(isNull(sections.archivedAt)),
      db.select({ id: topics.id, title: topics.title }).from(topics).where(isNull(topics.archivedAt)),
      db.select().from(accessRules).where(isNull(accessRules.archivedAt)),
      db
        .select({ userId: employeeProfiles.userId, name: employeeProfiles.displayName })
        .from(employeeProfiles)
        .innerJoin(users, eq(users.id, employeeProfiles.userId))
        .where(isNull(users.archivedAt)),
      db.select({ id: departments.id, name: departments.name }).from(departments).where(isNull(departments.archivedAt)),
      db.select({ id: roles.id, name: roles.name }).from(roles).where(isNull(roles.archivedAt)),
      db.select({ id: employeeTypes.id, name: employeeTypes.name }).from(employeeTypes).where(isNull(employeeTypes.archivedAt)),
      db.select({ id: locations.id, name: locations.name }).from(locations).where(isNull(locations.archivedAt)),
    ]);

  const selectedTarget = target ?? (pageRows[0] ? `page:${pageRows[0].id}` : '');
  const [selectedType = '', selectedId = ''] = selectedTarget.split(':');
  const rulesHere = ruleRows.filter((rule) => rule.targetType === selectedType && rule.targetId === selectedId);
  const counts = selectedId ? await matchCount(selectedType, selectedId) : { matched: 0, total: 0 };

  const label = (type: string, id: string) =>
    type === 'page'
      ? (pageRows.find((p) => p.id === id)?.title ?? 'a page')
      : type === 'topic'
        ? (topicRows.find((t) => t.id === id)?.title ?? 'a topic')
        : (sectionRows.find((s) => s.id === id)?.title ?? 'a section');

  return (
    <>
      <p className="eyebrow">Who sees what</p>
      <h1 className="page-title">Routing</h1>
      <p className="lead">
        A rule is rows of dropdowns that read back as a sentence. There is no JSON here, and there is no way to write one
        that the preview cannot explain to you in English.
      </p>

      <form method="get" action="/admin/access">
        <label className="field" style={{ maxWidth: 620 }}>
          <span>What this rule is about</span>
          <select className="input" name="target" defaultValue={selectedTarget}>
            <optgroup label="Sections">
              {sectionRows.map((row) => (
                <option key={row.id} value={`section:${row.id}`}>
                  {row.title}
                </option>
              ))}
            </optgroup>
            <optgroup label="Topics">
              {topicRows.map((row) => (
                <option key={row.id} value={`topic:${row.id}`}>
                  {row.title}
                </option>
              ))}
            </optgroup>
            <optgroup label="Pages">
              {pageRows.map((row) => (
                <option key={row.id} value={`page:${row.id}`}>
                  {row.sectionTitle} › {row.topicTitle} › {row.title}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <button className="btn" type="submit">
          Show its rules
        </button>
      </form>

      <h2 className="section-heading">Rules on {label(selectedType, selectedId)}</h2>
      {rulesHere.length === 0 ? (
        <p className="lead">
          No rule — this inherits from whatever sits above it. {counts.matched} of {counts.total}{' '}
          {counts.total === 1 ? 'person' : 'people'} can see it as things stand.
        </p>
      ) : (
        <>
          <p className="lead">
            {counts.matched} of {counts.total} {counts.total === 1 ? 'person' : 'people'} match as things stand.
          </p>
          <ul className="rows">
            {rulesHere.map((rule) => {
              const conditions = rule.conditions as Conditions;
              return (
                <li className="row" key={rule.id}>
                  <span className="meta" style={rule.effect === 'deny' ? { color: 'var(--color-accent-2-700)' } : undefined}>
                    {rule.effect === 'deny' ? 'Deny' : 'Allow'}
                  </span>
                  <span>
                    <span className="row-title">{ruleSentence(rule.effect as Effect, conditions, vocabulary)}</span>
                    {conditions.tenure ? (
                      <p className="meta" style={{ margin: '2px 0 0' }}>
                        {lockedExplainer(conditions, rule.visibilityWhenLocked as 'hidden' | 'teaser' | 'preview')}
                      </p>
                    ) : null}
                    <p style={{ margin: '4px 0 0' }}>
                      <MiniForm action={removeRule} csrf={csrf} hidden={{ id: rule.id }} label="Remove this rule" destructive />
                    </p>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h2 className="section-heading">Add a rule</h2>
      <RuleBuilder
        csrf={csrf}
        action={saveRule}
        targetType={selectedType}
        targetId={selectedId}
        departments={depts}
        roles={roleRows}
        employeeTypes={types}
        locations={sites}
      />

      <h2 className="section-heading">How it resolves, and why</h2>
      <ul className="rows">
        {TRUTH_TABLE.map(([rule, behaviour, result]) => (
          <li className="row" key={rule}>
            <span className="meta">{rule}</span>
            <span>
              <span className="row-title">{behaviour}</span>
              <p className="meta" style={{ margin: '2px 0 0' }}>{result}</p>
            </span>
          </li>
        ))}
      </ul>

      <h2 className="section-heading">Check it against a real person</h2>
      <p className="lead">
        Read-only, and it cannot change anything. It answers with the rule that decided, in the same words the rule is
        written in.
      </p>
      {people.length === 0 ? (
        <p className="lead">Nobody has an employee record yet, so there is nobody to check against.</p>
      ) : (
        <ActionForm action={explainForPerson} csrf={csrf} submitLabel="Explain it" pendingLabel="Working…">
          <label className="field">
            <span>Person</span>
            <select className="input" name="userId" required>
              {people.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Page</span>
            <select className="input" name="pageId" required defaultValue={selectedType === 'page' ? selectedId : ''}>
              {pageRows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>As at</span>
            <input className="input" type="date" name="at" />
            <span className="helper">Leave blank for today. A future date shows what unlocks by then.</span>
          </label>
        </ActionForm>
      )}
    </>
  );
}
