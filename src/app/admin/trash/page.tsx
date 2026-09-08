import { isNotNull } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { csrfToken } from '@/lib/csrf';
import { db } from '@/db/client';
import { pages, sections, topics } from '@/db/schema';
import { MiniForm } from '@/components/mini-form';
import { restoreAction } from '../content/actions';
import { purgeAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function TrashPage() {
  await requireAdmin();
  const csrf = await csrfToken();

  const [sectionRows, topicRows, pageRows] = await Promise.all([
    db.select().from(sections).where(isNotNull(sections.archivedAt)),
    db.select().from(topics).where(isNotNull(topics.archivedAt)),
    db.select().from(pages).where(isNotNull(pages.archivedAt)),
  ]);

  const items = [
    ...sectionRows.map((row) => ({ kind: 'section' as const, id: row.id, title: row.title, at: row.archivedAt! })),
    ...topicRows.map((row) => ({ kind: 'topic' as const, id: row.id, title: row.title, at: row.archivedAt! })),
    ...pageRows.map((row) => ({ kind: 'page' as const, id: row.id, title: row.title, at: row.archivedAt! })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <p className="eyebrow">Removed items</p>
      <h1 className="page-title">Nothing here is gone</h1>
      <p className="lead">
        Everything removed keeps its restore path. Purging is separate, explicit, and written to the audit log — it is
        the only thing in this product that does not come back.
      </p>

      {items.length === 0 ? (
        <p className="lead">Nothing removed in the last 30 days.</p>
      ) : (
        <ul className="rows">
          {items.map((item) => (
            <li className="row" key={`${item.kind}-${item.id}`}>
              <span className="meta">
                {item.kind}
                <br />
                {item.at.toLocaleDateString()}
              </span>
              <span>
                <span className="row-title">{item.title}</span>
                <p style={{ margin: '4px 0 0' }}>
                  <MiniForm action={restoreAction} csrf={csrf} hidden={{ kind: item.kind, id: item.id }} label="Restore it" />{' '}
                  <MiniForm
                    action={purgeAction}
                    csrf={csrf}
                    hidden={{ kind: item.kind, id: item.id }}
                    label="Purge"
                    destructive
                    confirm={`Purge “${item.title}”? This one does not come back.`}
                  />
                </p>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
