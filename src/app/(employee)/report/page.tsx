import { requireReader } from '@/lib/auth/guards';
import { csrfToken } from '@/lib/csrf';
import { ActionForm } from '@/components/action-form';
import { reportIssue } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireReader();
  const { page = '' } = await searchParams;
  const csrf = await csrfToken();

  return (
    <>
      <p className="eyebrow">Report</p>
      <h1 className="page-title">Something out of date</h1>
      <p className="lead">
        It arrives with the page reference attached. Whoever resolves it has to say what changed — or why it is not a
        fault — and those words come back to you.
      </p>

      <ActionForm action={reportIssue} csrf={csrf} submitLabel="Send it" pendingLabel="Sending…" hidden={{ pageSlug: page }}>
        <label className="field">
          <span>What kind of thing</span>
          <select className="input" name="kind" defaultValue="out_of_date">
            <option value="out_of_date">It is out of date</option>
            <option value="wrong">It is wrong</option>
            <option value="missing">Something is missing</option>
            <option value="unclear">I could not follow it</option>
            <option value="broken_link">A link goes nowhere</option>
          </select>
        </label>
        <label className="field">
          <span>What is wrong</span>
          <textarea className="input" name="body" rows={5} required />
        </label>
      </ActionForm>
    </>
  );
}
