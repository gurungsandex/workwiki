import { describe, it, expect } from 'vitest';
import { nextState, transitionProblem } from '@/lib/content/state';
import { canonicalJSON, contentHashHex } from '@/lib/content/canonical';
import { guideHandoffProblem, validateBlockData } from '@/lib/content/blocks';
import type { NodeState, Transition } from '@/lib/content/state';

describe('content state machine', () => {
  const table: [NodeState, Transition, NodeState | null][] = [
    ['draft', 'publish', 'published'],
    ['draft', 'archive', 'archived'],
    ['draft', 'unpublish', null],
    ['draft', 'restore', null],
    ['published', 'unpublish', 'draft'],
    ['published', 'archive', 'archived'],
    ['published', 'publish', null],
    ['published', 'restore', null],
    ['archived', 'restore', 'draft'],
    ['archived', 'publish', null],
    ['archived', 'unpublish', null],
    ['archived', 'archive', null],
  ];

  for (const [from, t, want] of table) {
    it(`${from} --${t}--> ${want ?? 'rejected'}`, () => {
      expect(nextState(from, t)).toBe(want);
      expect(transitionProblem(from, t) === null).toBe(want !== null);
    });
  }

  it('restore returns to draft, never straight to published', () => {
    expect(nextState('archived', 'restore')).toBe('draft');
  });
});

describe('content hash canonicalisation', () => {
  it('is stable across key order', () => {
    expect(contentHashHex({ a: 1, b: 2 })).toBe(contentHashHex({ b: 2, a: 1 }));
  });
  it('is stable across nested key order', () => {
    expect(contentHashHex({ x: { p: 1, q: [{ m: 1, n: 2 }] } })).toBe(
      contentHashHex({ x: { q: [{ n: 2, m: 1 }], p: 1 } }),
    );
  });
  it('is sensitive to a changed value', () => {
    expect(contentHashHex({ a: 1 })).not.toBe(contentHashHex({ a: 2 }));
  });
  it('is sensitive to array order, which is meaningful for blocks', () => {
    expect(contentHashHex([1, 2])).not.toBe(contentHashHex([2, 1]));
  });
  it('drops undefined but keeps null', () => {
    expect(canonicalJSON({ a: undefined, b: null })).toBe('{"b":null}');
  });
  it('produces a 64-char hex digest', () => {
    expect(contentHashHex({})).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('a guide must end in a real handoff', () => {
  it('rejects a guide whose last step names nobody and goes nowhere', () => {
    const problem = guideHandoffProblem({
      steps: [{ title: 'Tell your manager' }, { title: 'Wait' }],
      personalChecklist: true,
    });
    expect(problem).toMatch(/names nobody and goes nowhere/);
  });
  it('accepts a last step with a named owner', () => {
    expect(
      guideHandoffProblem({
        steps: [{ title: 'File it', owner: 'People Ops' }],
        personalChecklist: true,
      }),
    ).toBeNull();
  });
  it('accepts a last step with an external destination', () => {
    expect(
      guideHandoffProblem({
        steps: [
          {
            title: 'File the state claim',
            external: { url: 'https://example.gov/claim', domain: 'example.gov' },
          },
        ],
        personalChecklist: true,
      }),
    ).toBeNull();
  });
});

describe('block validation', () => {
  it('rejects an unknown kind rather than storing it', () => {
    expect(validateBlockData('not_a_kind', {})).toMatchObject({ ok: false });
  });
  it('names the failing path', () => {
    const r = validateBlockData('image', { fileObjectId: 'not-a-uuid', alt: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('image.fileObjectId');
  });
  it('requires alt text on an image at write time', () => {
    const r = validateBlockData('image', {
      fileObjectId: '11111111-1111-1111-1111-111111111111',
    });
    expect(r.ok).toBe(false);
  });
  it('accepts a valid summary', () => {
    expect(validateBlockData('summary', { text: 'Two sentences.' }).ok).toBe(true);
  });
});
