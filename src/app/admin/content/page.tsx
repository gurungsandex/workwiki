import Link from 'next/link';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { csrfToken } from '@/lib/csrf';
import { db } from '@/db/client';
import { blocks, pages, sections, topics } from '@/db/schema';
import { ActionForm } from '@/components/action-form';
import { MiniForm } from '@/components/mini-form';
import {
  addBlock,
  addPage,
  addSection,
  addTopic,
  archiveAction,
  archiveBlockAction,
  publishBlockAction,
  publishContainerAction,
  publishPageAction,
  unpublishAction,
} from './actions';

export const dynamic = 'force-dynamic';

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const { page: selectedPageId } = await searchParams;
  const csrf = await csrfToken();

  const [sectionRows, topicRows, pageRows] = await Promise.all([
    db.select().from(sections).where(isNull(sections.archivedAt)).orderBy(asc(sections.sortKey)),
    db.select().from(topics).where(isNull(topics.archivedAt)).orderBy(asc(topics.sortKey)),
    db.select().from(pages).where(isNull(pages.archivedAt)).orderBy(asc(pages.sortKey)),
  ]);

  const selected = selectedPageId ? pageRows.find((p) => p.id === selectedPageId) : undefined;
  const selectedBlocks = selected
    ? await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.pageId, selected.id), isNull(blocks.archivedAt)))
        .orderBy(asc(blocks.sortKey))
    : [];

  return (
    <>
      <p className="eyebrow">Sections</p>
      <h1 className="page-title">What is written down</h1>
      <p className="lead">
        Section, then topic, then page. A fourth level is a signal the content should be split — the depth stops here on
        purpose. Nothing reaches an employee until it is published.
      </p>

      {sectionRows.length === 0 ? (
        <p className="lead">Nothing yet. One published page is enough to be useful on day one.</p>
      ) : (
        sectionRows.map((section) => (
          <section key={section.id}>
            <h2 className="section-heading">
              {section.title}{' '}
              <span className="meta" style={{ fontSize: 12.5 }}>
                {section.state}
              </span>
            </h2>
            <p style={{ margin: '0 0 10px' }}>
              {section.state === 'published' ? (
                <MiniForm action={unpublishAction} csrf={csrf} hidden={{ kind: 'section', id: section.id }} label="Unpublish" />
              ) : (
                <MiniForm action={publishContainerAction} csrf={csrf} hidden={{ kind: 'section', id: section.id }} label="Publish the section" />
              )}{' '}
              <MiniForm
                action={archiveAction}
                csrf={csrf}
                hidden={{ kind: 'section', id: section.id }}
                label="Archive"
                destructive
                confirm={`Archive “${section.title}”? It moves to Removed items, with a restore path.`}
              />
            </p>

            {topicRows
              .filter((topic) => topic.sectionId === section.id)
              .map((topic) => (
                <div key={topic.id}>
                  <h3 className="sub-heading">
                    {topic.title}{' '}
                    <span className="meta" style={{ fontSize: 12.5 }}>
                      {topic.state}
                    </span>
                  </h3>
                  <p style={{ margin: '0 0 6px' }}>
                    {topic.state === 'published' ? (
                      <MiniForm action={unpublishAction} csrf={csrf} hidden={{ kind: 'topic', id: topic.id }} label="Unpublish" />
                    ) : (
                      <MiniForm action={publishContainerAction} csrf={csrf} hidden={{ kind: 'topic', id: topic.id }} label="Publish the topic" />
                    )}{' '}
                    <MiniForm action={archiveAction} csrf={csrf} hidden={{ kind: 'topic', id: topic.id }} label="Archive" destructive />
                  </p>
                  <ul className="rows" style={{ marginTop: 6 }}>
                    {pageRows
                      .filter((page) => page.topicId === topic.id)
                      .map((page) => (
                        <li className="row" key={page.id}>
                          <span className="meta">
                            {page.state}
                            {page.kind === 'statutory_posting' ? ' · required posting' : ''}
                            {page.requiresAcknowledgment ? ' · asks for acknowledgment' : ''}
                          </span>
                          <span>
                            <Link className="row-title" href={`/admin/content?page=${page.id}`}>
                              {page.title}
                            </Link>
                            <p style={{ margin: '4px 0 0' }}>
                              <MiniForm action={publishPageAction} csrf={csrf} hidden={{ pageId: page.id }} label="Publish this version" />{' '}
                              {page.state === 'published' ? (
                                <MiniForm action={unpublishAction} csrf={csrf} hidden={{ kind: 'page', id: page.id }} label="Unpublish" />
                              ) : null}{' '}
                              <MiniForm action={archiveAction} csrf={csrf} hidden={{ kind: 'page', id: page.id }} label="Archive" destructive />
                            </p>
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
          </section>
        ))
      )}

      {selected ? (
        <>
          <h2 className="section-heading">Blocks on “{selected.title}”</h2>
          {selectedBlocks.length === 0 ? (
            <p className="lead">This page has no blocks yet. Pick a block type below.</p>
          ) : (
            <ul className="rows">
              {selectedBlocks.map((block) => (
                <li className="row" key={block.id}>
                  <span className="meta">
                    {block.kind.replace('_', ' ')}
                    <br />
                    {block.kind === 'summary' && !block.publishedAt ? (
                      <span className="attention">not published</span>
                    ) : block.publishedAt ? (
                      `published ${block.publishedAt.toLocaleDateString()}`
                    ) : (
                      'included when the page is published'
                    )}
                  </span>
                  <span>
                    <span className="row-title">
                      {String(
                        (block.data as Record<string, unknown>).text ??
                          (block.data as Record<string, unknown>).title ??
                          ((block.data as Record<string, unknown>).points as string[] | undefined)?.[0] ??
                          '—',
                      ).slice(0, 160)}
                    </span>
                    <p style={{ margin: '4px 0 0' }}>
                      {block.kind === 'summary' && !block.publishedAt ? (
                        <>
                          <MiniForm action={publishBlockAction} csrf={csrf} hidden={{ blockId: block.id }} label="Publish this summary" />{' '}
                        </>
                      ) : null}
                      <MiniForm action={archiveBlockAction} csrf={csrf} hidden={{ blockId: block.id }} label="Remove from the page" destructive />
                    </p>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="sub-heading">Add a summary</h3>
          <p className="lead">
            The two or three sentences most people read. It stays a draft until you publish it, and the platform will not
            write it for you.
          </p>
          <ActionForm action={addBlock} csrf={csrf} submitLabel="Save the summary" hidden={{ pageId: selected.id, kind: 'summary' }}>
            <label className="field">
              <span>Summary</span>
              <textarea className="input" name="text" rows={4} required />
            </label>
            <label className="field">
              <span>The source it summarises</span>
              <input className="input" type="url" name="sourceUrl" placeholder="https://…" />
              <span className="helper">A summary cannot be saved unattached — name what governs.</span>
            </label>
          </ActionForm>

          <h3 className="sub-heading">Add what it means for you</h3>
          <ActionForm action={addBlock} csrf={csrf} submitLabel="Save the points" hidden={{ pageId: selected.id, kind: 'key_points' }}>
            <label className="field">
              <span>One point per line</span>
              <textarea className="input" name="points" rows={4} required />
            </label>
          </ActionForm>

          <h3 className="sub-heading">Add guidance</h3>
          <ActionForm action={addBlock} csrf={csrf} submitLabel="Save the guidance" hidden={{ pageId: selected.id, kind: 'rich_text' }}>
            <label className="field">
              <span>Body</span>
              <textarea className="input" name="body" rows={6} required />
              <span className="helper">Blank lines separate paragraphs.</span>
            </label>
          </ActionForm>

          <h3 className="sub-heading">Add steps</h3>
          <ActionForm action={addBlock} csrf={csrf} submitLabel="Save the steps" hidden={{ pageId: selected.id, kind: 'steps' }}>
            <label className="field">
              <span>One step per line</span>
              <textarea className="input" name="steps" rows={5} required />
            </label>
            <label className="field">
              <span>Where it ends</span>
              <input className="input" type="text" name="handoffLabel" required />
              <span className="helper">A guide must end in a real handoff — a named person, or a destination.</span>
            </label>
            <label className="field">
              <span>Destination, if it leaves the company</span>
              <input className="input" type="url" name="handoffHref" placeholder="https://…" />
              <span className="helper">The domain is shown to the employee, so one glance answers “does this leave us”.</span>
            </label>
          </ActionForm>
        </>
      ) : null}

      <h2 className="section-heading">Add a section</h2>
      <ActionForm action={addSection} csrf={csrf} submitLabel="Create the section">
        <label className="field">
          <span>Title</span>
          <input className="input" type="text" name="title" required />
        </label>
        <label className="field">
          <span>Lead line</span>
          <input className="input" type="text" name="lead" />
        </label>
      </ActionForm>

      {sectionRows.length > 0 ? (
        <>
          <h2 className="section-heading">Add a topic</h2>
          <ActionForm action={addTopic} csrf={csrf} submitLabel="Create the topic">
            <label className="field">
              <span>In which section</span>
              <select className="input" name="sectionId" required>
                {sectionRows.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Title</span>
              <input className="input" type="text" name="title" required />
            </label>
          </ActionForm>
        </>
      ) : null}

      {topicRows.length > 0 ? (
        <>
          <h2 className="section-heading">Add a page</h2>
          <ActionForm action={addPage} csrf={csrf} submitLabel="Create the page">
            <label className="field">
              <span>In which topic</span>
              <select className="input" name="topicId" required>
                {topicRows.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {sectionRows.find((s) => s.id === topic.sectionId)?.title} › {topic.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Title</span>
              <input className="input" type="text" name="title" required />
            </label>
            <label className="field">
              <span>The one line shown while it is locked</span>
              <input className="input" type="text" name="teaser" />
              <span className="helper">Employees who cannot read it yet see this, and the date it arrives.</span>
            </label>
            <label className="field">
              <span>What kind of page</span>
              <select className="input" name="kind" defaultValue="page">
                <option value="page">An ordinary page</option>
                <option value="statutory_posting">A required posting</option>
              </select>
              <span className="helper">
                A required posting is never summarised by this platform. You confirm the source instead, and that is what
                employees see.
              </span>
            </label>
            <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" name="requiresAcknowledgment" />
              <span style={{ letterSpacing: 0, textTransform: 'none', fontSize: 14 }}>Ask people to acknowledge it</span>
            </label>
          </ActionForm>
        </>
      ) : null}
    </>
  );
}
