import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireReader } from '@/lib/auth/guards';
import { loadPage } from '@/lib/content/read';
import { resolveContact } from '@/lib/contacts';
import { db } from '@/db/client';
import { acknowledgments } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { BlockView } from '@/components/blocks';
import { ContactCardView } from '@/components/contact-card';
import { AcknowledgeForm } from '@/components/acknowledge-form';
import { csrfToken } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { subject, viewer } = await requireReader();

  const read = await loadPage(slug, subject);
  // An unpublished page and a denied page are the same 404, deliberately.
  if (!read) notFound();

  const contact = await resolveContact({
    pageId: read.page.id,
    pageHelpCardId: read.page.helpContactCardId,
    topicId: read.page.topicId,
    topicHelpCardId: read.page.topicHelpContactCardId,
    sectionId: read.page.sectionId,
    sectionHelpCardId: read.page.sectionHelpContactCardId,
    departmentId: subject.departmentId,
    viewer,
  });

  if (read.state === 'locked') {
    return (
      <>
        <p className="eyebrow">
          {read.page.sectionTitle} · {read.page.topicTitle}
        </p>
        <h1 className="page-title">{read.page.title}</h1>
        <p className="lead locked">
          This one reaches you on {read.decision.unlockAt?.toLocaleDateString()}.
          {read.page.teaser ? ` ${read.page.teaser}` : ''}
        </p>
        <p className="meta">
          It is not hidden from you — it has not started yet. Nothing needs doing between now and then.
        </p>
        {contact ? <ContactCardView card={contact.card} heading="Who to ask in the meantime" /> : null}
      </>
    );
  }

  const bylines = new Map<string, string>();
  for (const block of read.blocks) {
    if (block.publishedAt && block.bylineKind) {
      bylines.set(
        block.id,
        block.bylineKind === 'confirmed'
          ? `Source confirmed ${block.publishedAt.toLocaleDateString()}.`
          : `Written and published ${block.publishedAt.toLocaleDateString()}.`,
      );
    }
  }

  const signed = read.version
    ? await db
        .select({ id: acknowledgments.id })
        .from(acknowledgments)
        .where(and(eq(acknowledgments.userId, subject.userId), eq(acknowledgments.pageVersionId, read.version.id)))
        .limit(1)
    : [];

  const csrf = await csrfToken();

  return (
    <article>
      <p className="eyebrow">
        {read.page.sectionTitle} · {read.page.topicTitle}
      </p>
      <h1 className="page-title">{read.page.title}</h1>
      {read.page.effectiveDate ? (
        <p className="meta">In effect from {new Date(read.page.effectiveDate).toLocaleDateString()}.</p>
      ) : null}

      <div className="stack">
        {read.blocks.map((block) => (
          <BlockView key={block.id} block={block} byline={bylines.get(block.id) ?? null} />
        ))}
      </div>

      {contact ? <ContactCardView card={contact.card} heading="Who to ask" /> : null}

      {read.page.requiresAcknowledgment && read.version ? (
        signed.length > 0 ? (
          <p className="notice">You acknowledged version {read.version.versionNo} of this page.</p>
        ) : (
          <AcknowledgeForm
            csrf={csrf}
            pageVersionId={read.version.id}
            contentHash={read.version.contentHash}
            versionNo={read.version.versionNo}
          />
        )
      ) : null}

      <p className="meta no-print" style={{ marginTop: 26 }}>
        <Link href={`/report?page=${read.page.slug}`}>Report something out of date</Link>
      </p>
    </article>
  );
}
