'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SaveState, submit } from '@/components/admin/SaveState';
import { ruleSentence, type Labels } from '@/lib/access/sentence';
import type { RuleConditions, TenureOffset } from '@/lib/access/types';

export type Option = { id: string; name: string };
export type NodeOption = { id: string; title: string; level: string; depth: number };
export type ExistingRule = {
  id: string;
  targetId: string;
  targetTitle: string;
  effect: 'allow' | 'deny';
  conditions: RuleConditions;
  visibilityWhenLocked: string;
};

/** The five tenure presets from the prototype, plus "from their first day". */
const TENURE_PRESETS: { value: string; label: string; offset: TenureOffset | null }[] = [
  { value: '0', label: 'from their first day', offset: null },
  { value: '30d', label: '30 days after hire', offset: { anchor: 'hire_date', unit: 'day', value: 30 } },
  { value: '60m', label: 'first of the month following 60 days after hire', offset: { anchor: 'hire_date', unit: 'day', value: 60, then: 'first_of_next_month' } },
  { value: '90d', label: '90 days after hire', offset: { anchor: 'hire_date', unit: 'day', value: 90 } },
  { value: '12m', label: '12 months after hire', offset: { anchor: 'hire_date', unit: 'month', value: 12 } },
];

const ANY = '__any__';

export function RuleBuilder({
  nodes,
  departments,
  roles,
  types,
  locations,
  rules,
}: {
  nodes: NodeOption[];
  departments: Option[];
  roles: Option[];
  types: Option[];
  locations: Option[];
  rules: ExistingRule[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [targetId, setTargetId] = useState(nodes[0]?.id ?? '');
  const [effect, setEffect] = useState<'allow' | 'deny'>('allow');
  const [dept, setDept] = useState(ANY);
  const [role, setRole] = useState(ANY);
  const [type, setType] = useState(ANY);
  const [loc, setLoc] = useState(ANY);
  const [tenure, setTenure] = useState('0');
  const [locked, setLocked] = useState<'teaser' | 'hidden'>('teaser');
  const [reach, setReach] = useState<{ visible: number; locked: number; hidden: number; headcount: number } | null>(null);

  const labels: Labels = {
    department: (id) => departments.find((d) => d.id === id)?.name ?? 'something removed',
    role: (id) => roles.find((r) => r.id === id)?.name ?? 'something removed',
    employeeType: (id) => types.find((t) => t.id === id)?.name ?? 'something removed',
    location: (id) => locations.find((l) => l.id === id)?.name ?? 'something removed',
    group: (slug) => slug,
  };

  const conditions = (): RuleConditions => {
    const c: RuleConditions = {};
    if (dept !== ANY) c.departmentIds = [dept];
    if (role !== ANY) c.roleIds = [role];
    if (type !== ANY) c.employeeTypeIds = [type];
    if (loc !== ANY) c.locationIds = [loc];
    const preset = TENURE_PRESETS.find((p) => p.value === tenure);
    if (preset?.offset) c.tenure = preset.offset;
    return c;
  };

  // The sentence is rendered from the same function the explain endpoint uses,
  // so what the admin reads here is what the evaluator will report later.
  const sentence = ruleSentence(conditions(), labels, effect);

  // Live reach for the selected node, recomputed by the real evaluator.
  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    void fetch('/api/admin/access-rules/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: targetId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { reach?: typeof reach } | null) => {
        if (!cancelled && d?.reach) setReach(d.reach);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [targetId, rules.length]);

  async function run(url: string, init: RequestInit) {
    setSaved(null);
    setError(null);
    const r = await submit(url, init);
    if (r.ok) {
      setSaved(r.message);
      startTransition(() => router.refresh());
    } else {
      setError(r.message);
    }
    return r.ok;
  }

  const selectStyle = { fontSize: 13.5 };
  const forNode = rules.filter((r) => r.targetId === targetId);

  return (
    <>
      <SaveState saved={saved} error={error} />

      {nodes.length === 0 ? (
        <p className="lead">
          Nothing to write a rule about yet. Add a section on the Sections tab first.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px', alignItems: 'flex-end', marginBottom: 24 }}>
            <label className="field">
              <span className="eyebrow">On</span>
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={selectStyle}>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {'— '.repeat(Math.max(0, n.depth - 1))}{n.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="eyebrow">Effect</span>
              <select value={effect} onChange={(e) => setEffect(e.target.value as 'allow' | 'deny')} style={selectStyle}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>
            </label>

            <Picker label="Employee type" value={type} setValue={setType} options={types} />
            <Picker label="Department" value={dept} setValue={setDept} options={departments} />
            <Picker label="Role" value={role} setValue={setRole} options={roles} />
            <Picker label="Work location" value={loc} setValue={setLoc} options={locations} />

            <label className="field">
              <span className="eyebrow">After</span>
              <select value={tenure} onChange={(e) => setTenure(e.target.value)} style={selectStyle}>
                {TENURE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>

            {effect === 'allow' ? (
              <label className="field">
                <span className="eyebrow">While locked, show</span>
                <select value={locked} onChange={(e) => setLocked(e.target.value as 'teaser' | 'hidden')} style={selectStyle}>
                  <option value="teaser">the title, the unlock date and one line</option>
                  <option value="hidden">nothing at all</option>
                </select>
              </label>
            ) : null}
          </div>

          <div style={{ borderLeft: '3px solid var(--color-accent)', padding: '4px 0 4px 18px', margin: '0 0 16px' }}>
            <p className="eyebrow" style={{ marginBottom: 6 }}>This rule reads</p>
            <p style={{ margin: '0 0 8px', fontSize: 21, lineHeight: 1.35, maxWidth: '56ch' }}>
              {sentence}
            </p>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--color-neutral-700)' }}>
              {reach === null
                ? 'Working out who this reaches…'
                : reach.headcount === 0
                  ? 'Nobody is on the roster yet, so this reaches no one until people are added.'
                  : `As things stand this page reaches ${reach.visible} of ${reach.headcount}` +
                    (reach.locked > 0 ? `, with ${reach.locked} seeing it locked until their date` : '') +
                    '.'}
            </p>
          </div>

          <button
            className="btn"
            type="button"
            disabled={pending || !targetId}
            onClick={() =>
              run('/api/admin/access-rules', {
                method: 'POST',
                body: JSON.stringify({
                  targetId,
                  effect,
                  conditions: conditions(),
                  visibilityWhenLocked: locked,
                }),
              })
            }
          >
            Save this rule
          </button>

          <p className="note" style={{ marginTop: 12 }}>
            Locked is not the same as denied. Somebody who fails only the tenure
            condition still sees that the page exists and when it arrives. Somebody who
            fails a department, role, type or site condition sees nothing at all.
          </p>

          {forNode.length > 0 ? (
            <section style={{ marginTop: 34 }}>
              <h3 style={{ fontSize: 19, marginBottom: 10 }}>
                Rules already on {nodes.find((n) => n.id === targetId)?.title}
              </h3>
              <div className="rows">
                {forNode.map((r) => (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14 }}>
                    <p style={{ margin: 0, fontSize: 15.5, maxWidth: '56ch' }}>
                      {ruleSentence(r.conditions, labels, r.effect)}
                    </p>
                    <button
                      className="inline-action inline-action-destructive"
                      type="button"
                      disabled={pending}
                      onClick={() => run(`/api/admin/access-rules/${r.id}`, { method: 'DELETE' })}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

function Picker({
  label,
  value,
  setValue,
  options,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: Option[];
}) {
  return (
    <label className="field">
      <span className="eyebrow">{label}</span>
      <select value={value} onChange={(e) => setValue(e.target.value)} style={{ fontSize: 13.5 }}>
        <option value={ANY}>Any</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </label>
  );
}
