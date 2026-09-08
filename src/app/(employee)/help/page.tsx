import { requireReader } from '@/lib/auth/guards';
import { resolveContact, resolveManager } from '@/lib/contacts';
import { ContactCardView } from '@/components/contact-card';
import { instanceSettings, filled } from '@/lib/instance';

export const dynamic = 'force-dynamic';

export default async function HelpPage() {
  const { subject, viewer } = await requireReader();
  const [general, manager, settings] = await Promise.all([
    resolveContact({ departmentId: subject.departmentId, viewer }),
    resolveManager(subject.userId, viewer),
    instanceSettings(),
  ]);

  const anything = general || manager || filled(settings?.enquiriesEmail) || filled(settings?.mainPhone);

  return (
    <>
      <p className="eyebrow">Help</p>
      <h1 className="page-title">Who to ask</h1>
      {anything ? (
        <p className="lead">Named people, resolved from your department and your site.</p>
      ) : (
        <p className="lead">
          Nobody has been named as a contact yet. When an admin adds one, they appear here and on every page that needs
          them.
        </p>
      )}

      {manager ? <ContactCardView card={manager} heading="Your manager" /> : null}
      {general ? <ContactCardView card={general.card} heading="For anything else" /> : null}

      {/* Blank company fields are hidden, never rendered as an empty card. */}
      {filled(settings?.enquiriesEmail) || filled(settings?.mainPhone) ? (
        <section>
          <h2 className="section-heading">The company</h2>
          <div className="row-single">
            {filled(settings?.enquiriesEmail) ? (
              <p className="meta" style={{ margin: 0 }}>
                <a href={`mailto:${settings!.enquiriesEmail}`}>{settings!.enquiriesEmail}</a>
              </p>
            ) : null}
            {filled(settings?.mainPhone) ? (
              <p className="meta" style={{ margin: '2px 0 0' }}>{settings!.mainPhone}</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
