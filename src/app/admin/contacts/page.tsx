import { isNull } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { csrfToken } from '@/lib/csrf';
import { db } from '@/db/client';
import { contactCards, departments, locations } from '@/db/schema';
import { ActionForm } from '@/components/action-form';
import { MiniForm } from '@/components/mini-form';
import { removeContact, saveContact } from './actions';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  await requireAdmin();
  const csrf = await csrfToken();
  const [cards, depts, sites] = await Promise.all([
    db.select().from(contactCards).where(isNull(contactCards.archivedAt)).orderBy(contactCards.label),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(isNull(departments.archivedAt)),
    db.select({ id: locations.id, name: locations.name }).from(locations).where(isNull(locations.archivedAt)),
  ]);

  return (
    <>
      <p className="eyebrow">Contacts</p>
      <h1 className="page-title">Who to ask</h1>
      <p className="lead">
        Cards are embedded by reference, so a changed number changes everywhere. A page resolves the nearest card: its
        own, then its topic, then its section, then the reader’s department, then this instance’s fallback.
      </p>

      {cards.length === 0 ? (
        <p className="lead">No contact card yet. Every unanswered search falls back to one, so it is worth doing first.</p>
      ) : (
        <ul className="rows">
          {cards.map((card) => (
            <li className="row" key={card.id}>
              <span className="meta">{card.label}</span>
              <span>
                <span className="row-title">{card.personName ?? 'Nobody named yet'}</span>
                <p className="meta" style={{ margin: '2px 0 0' }}>
                  {[card.roleTitle, card.email, card.phone].filter(Boolean).join(' · ') || 'Nothing filled in — employees see nothing rather than an empty card.'}
                </p>
                <p style={{ margin: '4px 0 0' }}>
                  <MiniForm action={removeContact} csrf={csrf} hidden={{ id: card.id }} label="Remove" destructive />
                </p>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-heading">Add a card</h2>
      <ActionForm action={saveContact} csrf={csrf} submitLabel="Save the card">
        <label className="field">
          <span>Label</span>
          <input className="input" type="text" name="label" required />
          <span className="helper">What people call this function — “People and Payroll”, “IT”.</span>
        </label>
        <label className="field">
          <span>Person</span>
          <input className="input" type="text" name="personName" />
        </label>
        <label className="field">
          <span>Their title</span>
          <input className="input" type="text" name="roleTitle" />
        </label>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" name="email" />
        </label>
        <label className="field">
          <span>Who sees the email</span>
          <select className="input" name="emailVisibility" defaultValue="all">
            <option value="all">Everyone</option>
            <option value="managers">Managers</option>
            <option value="admins">Admins only</option>
          </select>
        </label>
        <label className="field">
          <span>Phone</span>
          <input className="input" type="text" name="phone" />
        </label>
        <label className="field">
          <span>Who sees the phone</span>
          <select className="input" name="phoneVisibility" defaultValue="all">
            <option value="all">Everyone</option>
            <option value="managers">Managers</option>
            <option value="admins">Admins only</option>
          </select>
        </label>
        <label className="field">
          <span>Response time</span>
          <input className="input" type="text" name="responseTime" placeholder="within two working days" />
          <span className="helper">Shown to employees so they know what to expect before they chase.</span>
        </label>
        <label className="field">
          <span>Department it answers for</span>
          <select className="input" name="departmentId" defaultValue="">
            <option value="">Any</option>
            {depts.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Site it answers for</span>
          <select className="input" name="locationId" defaultValue="">
            <option value="">Any</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" name="isDefault" />
          <span style={{ letterSpacing: 0, textTransform: 'none', fontSize: 14 }}>
            Use this when nothing more specific resolves
          </span>
        </label>
      </ActionForm>
    </>
  );
}
