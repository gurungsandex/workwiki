import { sql } from '@/lib/db/client';
import { ContactsEditor, type ContactRow, type BindingRow } from './ContactsEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Who to ask' };

/**
 * Contact cards.
 *
 * A card is stored once and embedded by reference, so this screen is the only
 * place a phone number lives. Attaching a card to a section, a department or a
 * site is what makes it resolve on an employee's page.
 */
export default async function Contacts() {
  const db = sql();

  const [cards, bindings, departments, locations, nodes] = await Promise.all([
    db<ContactRow[]>`
      SELECT c.id, c.name, c.title, c.email, c.phone, c.extension, c.about,
             c.response_time_note AS "responseTimeNote",
             c.department_id AS "departmentId", c.location_id AS "locationId",
             c.is_default_hr AS "isDefaultHr", c.field_visibility AS "fieldVisibility"
        FROM contact_card c
       WHERE c.archived_at IS NULL
       ORDER BY c.is_default_hr DESC, c.name`,
    db<BindingRow[]>`
      SELECT b.id, b.card_id AS "cardId", b.target_type AS "targetType",
             b.purpose,
             COALESCE(n.title, d.name, l.name, 'something removed') AS "targetLabel"
        FROM contact_binding b
        LEFT JOIN content_node n ON b.target_type = 'node' AND n.id = b.target_id
        LEFT JOIN department d ON b.target_type = 'department' AND d.id = b.target_id
        LEFT JOIN location l ON b.target_type = 'location' AND l.id = b.target_id
       WHERE b.archived_at IS NULL
       ORDER BY b.sort_key`,
    db<{ id: string; name: string }[]>`
      SELECT id, name FROM department WHERE archived_at IS NULL ORDER BY name`,
    db<{ id: string; name: string }[]>`
      SELECT id, name FROM location WHERE archived_at IS NULL ORDER BY name`,
    db<{ id: string; name: string }[]>`
      SELECT id, title AS name FROM content_node
       WHERE archived_at IS NULL ORDER BY depth, sort_key, title`,
  ]);

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Who to ask</p>
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>Contacts</h1>
      <p className="lead" style={{ marginBottom: 14 }}>
        A contact is stored once here and pointed at from everywhere, so changing a
        number changes it on every page at once.
      </p>
      <p className="note" style={{ marginBottom: 34, fontStyle: 'italic' }}>
        A page resolves the closest contact above it: the page itself, then its topic,
        then its section, then the reader&rsquo;s department, then their site, then
        whoever you mark as the fallback. A surface with nobody named is hidden from
        employees rather than shown empty — so mark one fallback, at least.
      </p>

      <ContactsEditor
        cards={cards}
        bindings={bindings}
        departments={departments}
        locations={locations}
        nodes={nodes}
      />
    </>
  );
}
