import { z } from 'zod';

/**
 * `block.kind` selects a validator and a renderer; the typed payload lives in
 * `block.data`. Adding a block type adds a validator and a component here —
 * never a table, never a migration.
 */

const inlineText = z.string().max(20_000);

/** TipTap's schema is constrained to this shape; nothing else is stored. */
const richTextNode: z.ZodType = z.lazy(() =>
  z.object({
    type: z.enum(['doc', 'paragraph', 'text', 'bulletList', 'orderedList', 'listItem', 'heading', 'blockquote', 'hardBreak']),
    text: z.string().max(20_000).optional(),
    attrs: z.object({ level: z.number().int().min(2).max(4).optional() }).optional(),
    marks: z
      .array(z.object({ type: z.enum(['bold', 'italic', 'link']), attrs: z.object({ href: z.url() }).optional() }))
      .optional(),
    content: z.array(richTextNode).optional(),
  }),
);

export const BLOCK_SCHEMAS = {
  /** The two or three sentences people actually read. Draft until published. */
  summary: z.object({
    text: inlineText,
    /** The persistent, admin-editable note that this is a plain-language summary. */
    label: inlineText.default('This is a plain-language summary. The linked source governs.'),
  }),
  /** Written against the reader, not the organisation. */
  key_points: z.object({ points: z.array(inlineText).max(20) }),
  rich_text: z.object({ doc: richTextNode }),
  callout: z.object({ tone: z.enum(['note', 'attention']), text: inlineText }),
  /** A guide must end in a real handoff — enforced below, not merely asked for. */
  steps: z.object({
    steps: z.array(z.object({ text: inlineText, external: z.boolean().default(false) })).min(1).max(50),
    handoff: z
      .object({ kind: z.enum(['internal', 'external']), label: inlineText, href: z.url().optional(), contactCardId: z.uuid().optional() })
      .nullable(),
  }),
  document: z.object({ fileId: z.uuid(), caption: inlineText.optional() }),
  image: z.object({ fileId: z.uuid(), alt: z.string().min(1).max(500) }),
  contact_card: z.object({ cardId: z.uuid() }),
  external_link: z.object({
    href: z.url(),
    title: inlineText,
    /** Employees never see an unconfirmed link. */
    lastVerifiedAt: z.iso.datetime().nullable(),
  }),
  table: z.object({
    caption: inlineText.optional(),
    header: z.array(inlineText).max(12),
    rows: z.array(z.array(inlineText).max(12)).max(400),
  }),
  review: z.object({ ownerContactCardId: z.uuid().nullable(), reviewDueAt: z.iso.datetime().nullable() }),
} as const;

export type BlockKind = keyof typeof BLOCK_SCHEMAS;

export const BLOCK_KINDS = Object.keys(BLOCK_SCHEMAS) as BlockKind[];

export function isBlockKind(value: string): value is BlockKind {
  return value in BLOCK_SCHEMAS;
}

export interface BlockProblem {
  message: string;
}

/** Validate a block payload for its kind. Returns the parsed data or a problem. */
export function validateBlock(
  kind: string,
  data: unknown,
): { ok: true; data: Record<string, unknown> } | { ok: false; problem: BlockProblem } {
  if (!isBlockKind(kind)) return { ok: false, problem: { message: `There is no block type called "${kind}".` } };

  const parsed = BLOCK_SCHEMAS[kind].safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      problem: { message: issue ? `${issue.path.join('.') || 'This block'}: ${issue.message}` : 'This block is not valid.' },
    };
  }

  if (kind === 'steps') {
    const value = parsed.data as z.infer<(typeof BLOCK_SCHEMAS)['steps']>;
    if (!value.handoff) {
      return {
        ok: false,
        problem: {
          message: 'A step-by-step guide has to end somewhere. Add the handoff — who to hand this to, or where it goes.',
        },
      };
    }
    if (value.handoff.kind === 'external' && !value.handoff.href) {
      return { ok: false, problem: { message: 'An external handoff needs the destination, so the domain can be shown.' } };
    }
  }

  return { ok: true, data: parsed.data as Record<string, unknown> };
}

/** Plain text for the search index. Every kind contributes what it can. */
export function blockText(kind: string, data: Record<string, unknown>): string {
  const collect = (value: unknown): string[] => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(collect);
    if (value && typeof value === 'object') return Object.values(value).flatMap(collect);
    return [];
  };
  if (kind === 'image' || kind === 'document') return String(data.caption ?? data.alt ?? '');
  return collect(data).join(' ');
}
