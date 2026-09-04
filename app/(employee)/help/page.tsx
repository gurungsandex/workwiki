import { requireViewer } from '@/lib/auth/guard';
import { sql } from '@/lib/db/client';
import { resolveContactsForNode } from '@/lib/contacts/resolve';
import { ReportForm } from './ReportForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Help' };

export default async function Help() {
  const { subject, session } = await requireViewer();
  const contacts = await resolveContactsForNode(sql(), null, subject, {
    isAdmin: session.isAdmin,
    isManager: false,
  });

  return (
    <>
      <h1 style={{ fontSize: 29, marginBottom: 22 }}>Help</h1>

      {/* Any unfilled surface is hidden, never shown as an empty card. */}
      {contacts.length > 0 ? (
        <section style={{ marginBottom: 38 }}>
          <h2 style={{ fontSize: 25, marginBottom: 12 }}>Who to ask</h2>
          <div className="rows">
            {contacts.map((c) => (
              <div key={c.id}>
                <p className="eyebrow" style={{ marginBottom: 3 }}>{c.purpose}</p>
                <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>{c.name}</p>
                {c.title ? (
                  <p style={{ margin: '0 0 2px', fontSize: 13, color: 'var(--color-neutral-700)' }}>
                    {c.title}
                  </p>
                ) : null}
                {c.email ? (
                  <p style={{ margin: 0, fontSize: 12.5 }}>
                    <a href={`mailto:${c.email}`}>{c.email}</a>
                  </p>
                ) : null}
                {c.phone ? (
                  <p style={{ margin: 0, fontSize: 12.5 }}>{c.phone}</p>
                ) : null}
                {c.about ? (
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--color-neutral-600)', maxWidth: '62ch' }}>
                    {c.about}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 style={{ fontSize: 25, marginBottom: 6 }}>Report something out of date</h2>
        <p className="lead" style={{ marginBottom: 18 }}>
          If something here is wrong, missing or unreadable, say so. Your report goes to
          whoever maintains the handbook, with the page attached — and whoever resolves
          it has to say what changed.
        </p>
        <ReportForm />
      </section>
    </>
  );
}
