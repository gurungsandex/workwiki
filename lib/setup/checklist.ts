import type { Sql } from 'postgres';

/**
 * The setup checklist.
 *
 * Derived entirely from what exists in the instance. There is no stored step
 * number and no `progress` column: deleting the last department makes its line
 * revert on the next render, which is the property that makes it honest.
 */

export type ChecklistItem = {
  key: string;
  title: string;
  note: string;
  state: 'done' | 'started' | 'not-started';
  detail: string;
};

export async function checklist(sql: Sql): Promise<ChecklistItem[]> {
  const [counts] = await sql<
    {
      departments: string;
      roles: string;
      types: string;
      locations: string;
      people: string;
      sections: string;
      published: string;
      rules: string;
      contacts: string;
      company_named: boolean;
    }[]
  >`
    SELECT
      (SELECT count(*) FROM department      WHERE archived_at IS NULL)::text AS departments,
      (SELECT count(*) FROM role            WHERE archived_at IS NULL)::text AS roles,
      (SELECT count(*) FROM employee_type   WHERE archived_at IS NULL)::text AS types,
      (SELECT count(*) FROM location        WHERE archived_at IS NULL)::text AS locations,
      (SELECT count(*) FROM employee_profile WHERE archived_at IS NULL)::text AS people,
      (SELECT count(*) FROM content_node    WHERE archived_at IS NULL)::text AS sections,
      (SELECT count(*) FROM content_node    WHERE archived_at IS NULL
                                              AND state = 'published')::text AS published,
      (SELECT count(*) FROM access_rule     WHERE archived_at IS NULL)::text AS rules,
      (SELECT count(*) FROM contact_card    WHERE archived_at IS NULL)::text AS contacts,
      (SELECT display_name IS NOT NULL FROM company_setting WHERE singleton) AS company_named`;

  const n = (v: string | undefined) => Number(v ?? 0);
  const state = (done: boolean, started: boolean): ChecklistItem['state'] =>
    done ? 'done' : started ? 'started' : 'not-started';

  return [
    {
      key: 'company',
      title: 'Name the company',
      note: 'Feeds the contacts page and every date that depends on a leave year. Blank fields are hidden from employees rather than shown empty.',
      state: counts?.company_named ? 'done' : 'not-started',
      detail: counts?.company_named ? 'Set' : 'Not set',
    },
    {
      key: 'dimensions',
      title: 'Add departments, roles, employee types and sites',
      note: 'Every access rule is written in these words. Nothing is built in — a company with no second site deletes that one and nothing breaks.',
      state: state(
        n(counts?.departments) > 0 && n(counts?.locations) > 0 && n(counts?.types) > 0,
        n(counts?.departments) > 0 || n(counts?.locations) > 0,
      ),
      detail: `${n(counts?.departments)} departments, ${n(counts?.roles)} roles, ${n(counts?.types)} types, ${n(counts?.locations)} sites`,
    },
    {
      key: 'contacts',
      title: 'Name at least one person to ask',
      note: 'Every page resolves a contact. Without one, an employee who finds nothing has nowhere to go.',
      state: state(n(counts?.contacts) > 0, false),
      detail: n(counts?.contacts) === 0 ? 'Nobody named yet' : `${n(counts?.contacts)} contact cards`,
    },
    {
      key: 'content',
      title: 'Write something',
      note: 'A section, a topic and a page. The product is useful with one page published.',
      state: state(n(counts?.published) > 0, n(counts?.sections) > 0),
      detail: `${n(counts?.sections)} items, ${n(counts?.published)} published`,
    },
    {
      key: 'rules',
      title: 'Say who sees what',
      note: 'Nothing is public by default. A page with no rule anywhere in its ancestry reaches nobody.',
      state: state(n(counts?.rules) > 0, false),
      detail: n(counts?.rules) === 0 ? 'No rules yet' : `${n(counts?.rules)} rules`,
    },
    {
      key: 'people',
      title: 'Invite employees',
      note: 'Each person sees only the version of the handbook their own record produces.',
      state: state(n(counts?.people) > 1, n(counts?.people) > 0),
      detail: `${n(counts?.people)} people`,
    },
  ];
}
