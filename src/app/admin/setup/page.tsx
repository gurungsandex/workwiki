import { requireAdmin } from '@/lib/auth/guards';
import { csrfToken } from '@/lib/csrf';
import { instanceSettings } from '@/lib/instance';
import { setupState } from '@/lib/setup';
import { ActionForm } from '@/components/action-form';
import { saveCompanyDetails, setAccent, testMail } from '@/app/setup/actions';
import { db } from '@/db/client';
import { instance } from '@/db/schema';
import { mailConfigured } from '@/lib/mail';

export const dynamic = 'force-dynamic';

const FIELDS: { name: string; label: string; helper: string; required?: boolean }[] = [
  { name: 'legalName', label: 'Registered legal name', helper: 'Appears on policy pages that name the employer.', required: true },
  { name: 'displayName', label: 'Display name', helper: 'What employees see at the top of every screen.', required: true },
  { name: 'street', label: 'Street', helper: 'Used on printed pages and statutory postings.' },
  { name: 'suite', label: 'Suite or floor', helper: 'Optional, printed with the address.' },
  { name: 'city', label: 'City', helper: 'Resolves the default site for people with no site set.', required: true },
  { name: 'region', label: 'State or region', helper: 'Drives which jurisdiction scaffolds are offered.' },
  { name: 'postalCode', label: 'Postal code', helper: 'Printed with the address.' },
  { name: 'country', label: 'Country', helper: 'Drives federal-level scaffolds.', required: true },
  { name: 'mainPhone', label: 'Main phone', helper: 'Shown on the Help screen when no card resolves.' },
  { name: 'enquiriesEmail', label: 'Enquiries email', helper: 'The fallback address on every unanswered search.', required: true },
  { name: 'website', label: 'Website', helper: 'Linked from printed pages.' },
  { name: 'firstContactName', label: 'First contact — name', helper: 'Who an employee reaches when nothing else resolves.' },
  { name: 'firstContactEmail', label: 'First contact — email', helper: 'Pre-filled into failed-search emails.' },
  { name: 'firstContactPhone', label: 'First contact — phone', helper: 'Shown beside the name.' },
];

export default async function AdminSetupPage() {
  await requireAdmin();
  const [csrf, settings, state] = await Promise.all([csrfToken(), instanceSettings(), setupState()]);
  const [row] = await db.select().from(instance).limit(1);

  return (
    <>
      <p className="eyebrow">Setup · the company itself</p>
      <h1 className="page-title">The company itself</h1>
      <p className="lead">
        {state.companyFieldsFilled} of {state.companyFieldsRequired} required details filled. The rest of setup does not
        wait for them — a blank field is hidden from employees rather than shown as an empty card.
      </p>

      <ActionForm action={saveCompanyDetails} csrf={csrf} submitLabel="Save the details" pendingLabel="Saving…">
        {FIELDS.map((field) => {
          const value = (row as Record<string, unknown> | undefined)?.[field.name];
          const empty = !String(value ?? '').trim();
          return (
            <label className="field" key={field.name}>
              <span>{field.label}</span>
              <input className="input" type="text" name={field.name} defaultValue={String(value ?? '')} />
              <span className={`helper${field.required && empty ? ' helper-required' : ''}`}>
                {field.required && empty ? `Required. ${field.helper}` : field.helper}
              </span>
            </label>
          );
        })}
        <label className="field">
          <span>Timezone</span>
          <input className="input" type="text" name="timeZone" defaultValue={settings?.timeZone ?? 'UTC'} required />
          <span className="helper">
            Unlock dates resolve at local midnight here, unless a site sets its own. An IANA name, like America/New_York.
          </span>
        </label>
        <label className="field">
          <span>Size band</span>
          <input className="input" type="text" name="sizeBand" defaultValue={row?.sizeBand ?? ''} />
          <span className="helper">Only used to size defaults in the rule builder.</span>
        </label>
        <label className="field">
          <span>Leave year starts</span>
          <input className="input" type="text" name="leaveYearStart" defaultValue={row?.leaveYearStart ?? ''} placeholder="01-01" />
          <span className="helper">Month and day. Entitlement pages count from here.</span>
        </label>
      </ActionForm>

      <h2 className="section-heading">Accent</h2>
      <p className="lead">One colour, applied everywhere. Cyan is the default; the magenta second signal is not settable.</p>
      <ActionForm action={setAccent} csrf={csrf} submitLabel="Save the accent">
        <label className="field">
          <span>Accent colour</span>
          <input className="input" type="text" name="accentColor" defaultValue={settings?.accentColor ?? ''} placeholder="#0088b0" />
          <span className="helper">A hex colour. Leave it blank for the default.</span>
        </label>
      </ActionForm>

      <h2 className="section-heading">Mail</h2>
      <p className="lead">
        {mailConfigured()
          ? 'Configured. Test it before you invite anybody — an invitation that never arrives looks like a broken product.'
          : 'Not configured on this deployment. Set SMTP_HOST and MAIL_FROM in the environment; invitations and reset links need them.'}
      </p>
      <ActionForm action={testMail} csrf={csrf} submitLabel="Send a test" pendingLabel="Testing…" />
    </>
  );
}
