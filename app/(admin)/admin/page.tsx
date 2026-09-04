import { sql } from '@/lib/db/client';
import { checklist } from '@/lib/setup/checklist';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Setup' };

const MARK = { done: '✓', started: '◐', 'not-started': '○' } as const;

export default async function AdminSetup() {
  const items = await checklist(sql());

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Setup</p>
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>What is left to do</h1>
      <p className="lead" style={{ marginBottom: 30 }}>
        This list is derived from what actually exists in the instance, not from a
        stored step number. Delete a department and its line comes back.
      </p>

      <div className="rows">
        {items.map((item) => (
          <div
            key={item.key}
            style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 16 }}
          >
            <span
              style={{
                fontSize: 17,
                color:
                  item.state === 'done'
                    ? 'var(--color-accent-700)'
                    : item.state === 'started'
                      ? 'var(--color-accent-2-700)'
                      : 'var(--color-neutral-500)',
              }}
              aria-hidden="true"
            >
              {MARK[item.state]}
            </span>
            <div>
              <p
                style={{
                  margin: '0 0 2px',
                  fontSize: 16.5,
                  color:
                    item.state === 'done' ? 'var(--color-neutral-600)' : 'var(--color-text)',
                }}
              >
                {item.title}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-700)', maxWidth: '66ch' }}>
                {item.note}
              </p>
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--color-neutral-600)', whiteSpace: 'nowrap' }}>
              {item.detail}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
