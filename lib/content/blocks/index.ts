import { z } from 'zod';

/**
 * The block-kind registry.
 *
 * `kind` selects a validator and a renderer; the typed payload lives in
 * `block.data`. Adding a kind adds an entry here and a component — NOT a
 * migration. That is why `block.kind` has no CHECK constraint.
 */

/** The five-beat page order the employee always sees (spec §8). */
export const SLOTS = [
  'summary',
  'key_points',
  'guidance',
  'who_to_ask',
  'source',
] as const;
export type Slot = (typeof SLOTS)[number];

const richTextNode: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(40),
    text: z.string().max(20_000).optional(),
    attrs: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    marks: z
      .array(z.object({ type: z.string().min(1).max(40) }).passthrough())
      .max(20)
      .optional(),
    content: z.array(richTextNode).max(500).optional(),
  }),
);

/** The TipTap schema is constrained: only these node and mark types survive. */
export const ALLOWED_NODES = new Set([
  'doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList',
  'listItem', 'blockquote', 'hardBreak', 'horizontalRule',
]);
export const ALLOWED_MARKS = new Set(['bold', 'italic', 'link']);

const step = z.object({
  title: z.string().min(1).max(300),
  detail: z.string().max(2000).optional(),
  /** A guide must end in a real handoff: a person, a system, or a destination. */
  owner: z.string().max(200).optional(),
  external: z
    .object({
      url: z.string().url(),
      domain: z.string().max(253),
      lastVerifiedAt: z.string().optional(),
    })
    .optional(),
});

export const BLOCK_KINDS = {
  rich_text: z.object({ doc: richTextNode }),

  summary: z.object({
    text: z.string().min(1).max(5000),
    /** The persistent, admin-editable note that this is a plain-language summary. */
    label: z.string().max(400).optional(),
  }),

  key_points: z.object({
    points: z.array(z.string().min(1).max(500)).min(1).max(20),
  }),

  callout: z.object({
    tone: z.enum(['note', 'attention']),
    text: z.string().min(1).max(2000),
  }),

  document: z.object({
    fileObjectId: z.string().uuid(),
    caption: z.string().max(300).optional(),
  }),

  image: z.object({
    fileObjectId: z.string().uuid(),
    /** Enforced at upload time rather than requested later (spec §8). */
    alt: z.string().min(1).max(500),
    caption: z.string().max(300).optional(),
  }),

  contact_card: z.object({ cardId: z.string().uuid() }),

  external_link: z.object({
    url: z.string().url(),
    title: z.string().min(1).max(300),
    /** Shown to the reader so one glance answers "does this leave the company?" */
    domain: z.string().min(1).max(253),
    lastVerifiedAt: z.string().optional(),
  }),

  table: z.object({
    caption: z.string().max(300).optional(),
    headers: z.array(z.string().max(200)).max(12),
    rows: z.array(z.array(z.string().max(2000)).max(12)).max(500),
  }),

  guide: z.object({
    steps: z.array(step).min(1).max(50),
    /** "for your own tracking — this notifies no one and submits nothing" */
    personalChecklist: z.boolean().default(true),
  }),
} as const;

export type BlockKind = keyof typeof BLOCK_KINDS;

export function isBlockKind(k: string): k is BlockKind {
  return Object.prototype.hasOwnProperty.call(BLOCK_KINDS, k);
}

export function validateBlockData(kind: string, data: unknown) {
  if (!isBlockKind(kind)) {
    return { ok: false as const, error: `Unknown block kind: ${kind}` };
  }
  const parsed = BLOCK_KINDS[kind].safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false as const,
      error: `${kind}.${first?.path.join('.') || '(root)'}: ${first?.message ?? 'invalid'}`,
    };
  }
  return { ok: true as const, data: parsed.data };
}

/**
 * A guide must end in a real handoff. Enforced at publish, so a guide that
 * stops in mid-air cannot reach an employee.
 */
export function guideHandoffProblem(data: unknown): string | null {
  const parsed = BLOCK_KINDS.guide.safeParse(data);
  if (!parsed.success) return 'This guide is not valid.';
  const last = parsed.data.steps[parsed.data.steps.length - 1];
  if (!last) return 'This guide has no steps.';
  if (!last.owner && !last.external) {
    return 'The last step names nobody and goes nowhere. A guide must end in a named person, a system, or an external destination.';
  }
  return null;
}

/** Flattens a block's text for the search index. */
export function blockText(kind: string, data: unknown): string {
  const d = data as Record<string, unknown>;
  switch (kind) {
    case 'summary':
      return String(d.text ?? '');
    case 'key_points':
      return (d.points as string[] | undefined)?.join(' ') ?? '';
    case 'callout':
      return String(d.text ?? '');
    case 'external_link':
      return `${d.title ?? ''} ${d.domain ?? ''}`;
    case 'table':
      return [
        String(d.caption ?? ''),
        ((d.headers as string[]) ?? []).join(' '),
        ((d.rows as string[][]) ?? []).flat().join(' '),
      ].join(' ');
    case 'guide':
      return ((d.steps as { title?: string; detail?: string }[]) ?? [])
        .map((s) => `${s.title ?? ''} ${s.detail ?? ''}`)
        .join(' ');
    case 'rich_text':
      return richTextToText(d.doc);
    default:
      return '';
  }
}

function richTextToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { text?: string; content?: unknown[] };
  const own = typeof n.text === 'string' ? n.text : '';
  const kids = Array.isArray(n.content) ? n.content.map(richTextToText).join(' ') : '';
  return `${own} ${kids}`.trim();
}
