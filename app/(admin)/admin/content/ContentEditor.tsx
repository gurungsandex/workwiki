'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SaveState, submit } from '@/components/admin/SaveState';
import {
  BLOCK_CHOICES,
  BlockFields,
  blankData,
  describeBlock,
  type BlockRow,
} from './BlockEditor';

export type NodeRow = {
  id: string;
  level: 'section' | 'topic' | 'page';
  parentId: string | null;
  depth: number;
  title: string;
  slug: string;
  state: 'draft' | 'published' | 'archived';
  teaser: string | null;
  archived: boolean;
  versions: number;
  hasRule: boolean;
};

/**
 * The content editor.
 *
 * No design existed for this surface, so it is built from Broadsheet's own
 * parts: the structure as list rows with a 1px separator, blocks as typed forms
 * beneath the selected page, and the state of every item stated in words rather
 * than a badge. See docs/DECISIONS.md §12.
 */
export function ContentEditor({
  nodes,
  blocks,
  kinds,
}: {
  nodes: NodeRow[];
  blocks: Record<string, BlockRow[]>;
  kinds: { id: string; name: string; neverSummarised: boolean }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(
    nodes.find((n) => n.level === 'page' && !n.archived)?.id ?? null,
  );
  const [addingUnder, setAddingUnder] = useState<string | 'root' | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [addingBlock, setAddingBlock] = useState<string | null>(null);
  const [blockKind, setBlockKind] = useState('summary');
  const [blockDraft, setBlockDraft] = useState<Record<string, unknown>>(blankData('summary'));
  const [blockSource, setBlockSource] = useState('');
  const [editingBlock, setEditingBlock] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});

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

  const live = nodes.filter((n) => !n.archived);
  const archived = nodes.filter((n) => n.archived);
  const childrenOf = (id: string | null) => live.filter((n) => n.parentId === id);

  const childLevel = (parent: NodeRow | null): 'section' | 'topic' | 'page' =>
    parent === null ? 'section' : parent.level === 'section' ? 'topic' : 'page';

  const selectedNode = live.find((n) => n.id === selected) ?? null;
  const selectedBlocks = selected ? (blocks[selected] ?? []) : [];

  const addForm = (parent: NodeRow | null) => {
    const key = parent?.id ?? 'root';
    if (addingUnder !== key) {
      return (
        <button
          className="inline-action"
          type="button"
          onClick={() => {
            setAddingUnder(key);
            setNewTitle('');
          }}
        >
          Add a {childLevel(parent)}
        </button>
      );
    }
    return (
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6 }}
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run('/api/admin/content', {
            method: 'POST',
            body: JSON.stringify({
              level: childLevel(parent),
              parentId: parent?.id ?? null,
              title: newTitle,
            }),
          });
          if (ok) {
            setAddingUnder(null);
            setNewTitle('');
          }
        }}
      >
        <label className="field">
          <span className="eyebrow">New {childLevel(parent)}</span>
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            required
            maxLength={200}
            style={{ minWidth: 260 }}
          />
        </label>
        <button className="btn" type="submit" disabled={pending || !newTitle.trim()}>Add</button>
        <button className="inline-action" type="button" onClick={() => setAddingUnder(null)}>
          Cancel
        </button>
      </form>
    );
  };

  return (
    <>
      <SaveState saved={saved} error={error} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: 40, alignItems: 'start' }}>
        {/* ---- the tree ---- */}
        <div>
          <h2 style={{ fontSize: 24, marginBottom: 12 }}>Structure</h2>
          {live.length === 0 ? (
            <p className="lead" style={{ marginBottom: 12 }}>
              Nothing here yet. A section holds topics, a topic holds pages, and a page
              is what an employee reads.
            </p>
          ) : (
            <div className="rows" style={{ marginBottom: 12 }}>
              {childrenOf(null).map((section) => (
                <TreeNode
                  key={section.id}
                  node={section}
                  childrenOf={childrenOf}
                  selected={selected}
                  onSelect={setSelected}
                  pending={pending}
                  run={run}
                  addForm={addForm}
                />
              ))}
            </div>
          )}
          {addForm(null)}

          {archived.length > 0 ? (
            <details style={{ marginTop: 20 }}>
              <summary style={{ fontSize: 12.5, color: 'var(--color-neutral-600)', cursor: 'pointer' }}>
                Removed ({archived.length})
              </summary>
              <div className="rows" style={{ marginTop: 8 }}>
                {archived.map((n) => (
                  <div key={n.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
                    <p style={{ margin: 0, fontSize: 14.5, color: 'var(--color-neutral-700)' }}>
                      {n.title}
                    </p>
                    <button
                      className="inline-action"
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(`/api/admin/content/${n.id}`, {
                          method: 'POST',
                          body: JSON.stringify({ action: 'restore' }),
                        })
                      }
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>

        {/* ---- the selected page ---- */}
        <div>
          {selectedNode === null ? (
            <p className="lead">Choose something on the left to fill it in.</p>
          ) : (
            <>
              <p className="eyebrow" style={{ marginBottom: 6 }}>
                {selectedNode.level}
                {selectedNode.state === 'published' ? ' · published' : ' · draft, nobody sees it'}
              </p>
              <h2 style={{ fontSize: 25, marginBottom: 6 }}>{selectedNode.title}</h2>

              {!selectedNode.hasRule ? (
                <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-accent-2-700)', maxWidth: '62ch' }}>
                  No rule anywhere above this reaches anybody. Nothing is public by
                  default, so publishing it now would still show it to no one — write a
                  rule on the Who sees what tab.
                </p>
              ) : null}

              <TeaserField node={selectedNode} pending={pending} run={run} />

              <h3 style={{ fontSize: 19, margin: '26px 0 10px' }}>Blocks</h3>
              {selectedBlocks.length === 0 ? (
                <p className="lead" style={{ marginBottom: 12 }}>
                  This page has no blocks yet.
                </p>
              ) : (
                <div className="rows" style={{ marginBottom: 14 }}>
                  {selectedBlocks.map((b) => (
                    <div key={b.id}>
                      {editingBlock === b.id ? (
                        <div style={{ display: 'grid', gap: 12, padding: '6px 0 12px' }}>
                          <BlockFields kind={b.kind} data={editDraft} onChange={setEditDraft} />
                          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                            <button
                              className="btn"
                              type="button"
                              disabled={pending}
                              onClick={async () => {
                                const ok = await run(`/api/admin/blocks/${b.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ data: editDraft }),
                                });
                                if (ok) setEditingBlock(null);
                              }}
                            >
                              Save
                            </button>
                            <button className="inline-action" type="button" onClick={() => setEditingBlock(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14 }}>
                          <div>
                            <p className="eyebrow" style={{ marginBottom: 3 }}>
                              {BLOCK_CHOICES.find((c) => c.kind === b.kind)?.label ?? b.kind}
                              {b.kind === 'summary' ? (
                                <span style={{ color: b.publishedAt ? 'var(--color-accent-700)' : 'var(--color-accent-2-700)' }}>
                                  {b.publishedAt
                                    ? b.bylineKind === 'confirmed_source'
                                      ? ' · source confirmed'
                                      : ' · published'
                                    : ' · draft, not published'}
                                </span>
                              ) : null}
                            </p>
                            <p style={{ margin: 0, fontSize: 14.5, color: 'var(--color-neutral-700)', maxWidth: '62ch' }}>
                              {describeBlock(b)}
                            </p>
                          </div>
                          <div style={{ display: 'flex', gap: 12, whiteSpace: 'nowrap' }}>
                            {b.kind === 'summary' && !b.publishedAt ? (
                              <button
                                className="inline-action"
                                type="button"
                                disabled={pending}
                                onClick={() =>
                                  run(`/api/admin/blocks/${b.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ action: 'publish-summary' }),
                                  })
                                }
                              >
                                Publish summary
                              </button>
                            ) : null}
                            <button
                              className="inline-action"
                              type="button"
                              onClick={() => {
                                setEditingBlock(b.id);
                                setEditDraft(b.data);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              className="inline-action inline-action-destructive"
                              type="button"
                              disabled={pending}
                              onClick={() => run(`/api/admin/blocks/${b.id}`, { method: 'DELETE' })}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {addingBlock === selectedNode.id ? (
                <form
                  style={{ display: 'grid', gap: 14, maxWidth: 620, marginBottom: 16 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await run('/api/admin/blocks', {
                      method: 'POST',
                      body: JSON.stringify({
                        nodeId: selectedNode.id,
                        kind: blockKind,
                        data: blockDraft,
                        sourceUrl: blockKind === 'summary' ? blockSource || null : null,
                      }),
                    });
                    if (ok) {
                      setAddingBlock(null);
                      setBlockDraft(blankData(blockKind));
                      setBlockSource('');
                    }
                  }}
                >
                  <label className="field">
                    <span className="eyebrow">Block type</span>
                    <select
                      value={blockKind}
                      onChange={(e) => {
                        setBlockKind(e.target.value);
                        setBlockDraft(blankData(e.target.value));
                      }}
                    >
                      {BLOCK_CHOICES.map((c) => (
                        <option key={c.kind} value={c.kind}>{c.label}</option>
                      ))}
                    </select>
                    <span className="helper">
                      {BLOCK_CHOICES.find((c) => c.kind === blockKind)?.hint}
                    </span>
                  </label>

                  <BlockFields kind={blockKind} data={blockDraft} onChange={setBlockDraft} />

                  {blockKind === 'summary' ? (
                    <label className="field">
                      <span className="eyebrow">What it summarises</span>
                      <input
                        type="url"
                        required
                        placeholder="https://… the document this stands in for"
                        value={blockSource}
                        onChange={(e) => setBlockSource(e.target.value)}
                      />
                      <span className="helper">
                        A summary cannot exist unattached — the source governs where they
                        differ, and employees are told so.
                      </span>
                    </label>
                  ) : null}

                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <button className="btn" type="submit" disabled={pending}>Add this block</button>
                    <button className="inline-action" type="button" onClick={() => setAddingBlock(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  className="inline-action"
                  type="button"
                  onClick={() => {
                    setAddingBlock(selectedNode.id);
                    setBlockKind('summary');
                    setBlockDraft(blankData('summary'));
                  }}
                >
                  Add a block
                </button>
              )}

              <div style={{ marginTop: 30, paddingTop: 16, borderTop: '1px solid var(--color-neutral-300)' }}>
                {selectedNode.state === 'published' ? (
                  <>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(`/api/admin/content/${selectedNode.id}`, {
                          method: 'POST',
                          body: JSON.stringify({ action: 'unpublish' }),
                        })
                      }
                    >
                      Take it back to draft
                    </button>
                    <p className="note" style={{ marginTop: 8 }}>
                      Published {selectedNode.versions === 1 ? 'once' : `${selectedNode.versions} times`}.
                      Publishing again stamps a new version, and anyone who acknowledged
                      the old one is asked again.
                    </p>
                  </>
                ) : (
                  <>
                    <button
                      className="btn"
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(`/api/admin/content/${selectedNode.id}`, {
                          method: 'POST',
                          body: JSON.stringify({ action: 'publish' }),
                        })
                      }
                    >
                      Publish
                    </button>
                    <p className="note" style={{ marginTop: 8 }}>
                      Publishing snapshots exactly what is here now. A guide with nowhere
                      to hand off, or a summary still in draft, will stop it — and say so.
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function TreeNode({
  node,
  childrenOf,
  selected,
  onSelect,
  pending,
  run,
  addForm,
}: {
  node: NodeRow;
  childrenOf: (id: string | null) => NodeRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  pending: boolean;
  run: (url: string, init: RequestInit) => Promise<boolean>;
  addForm: (parent: NodeRow | null) => React.ReactNode;
}) {
  const kids = childrenOf(node.id);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, paddingLeft: (node.depth - 1) * 18 }}>
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          style={{
            font: 'inherit',
            textAlign: 'left',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: selected === node.id ? 'var(--color-accent-700)' : 'var(--color-text)',
          }}
        >
          <span style={{ fontSize: 15.5 }}>{node.title}</span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-neutral-600)' }}>
            {node.state === 'published' ? 'Published' : 'Draft'}
            {node.hasRule ? '' : ' · no rule reaches it'}
          </span>
        </button>
        <div style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
          <button
            className="inline-action"
            type="button"
            disabled={pending}
            onClick={() => run(`/api/admin/content/${node.id}`, { method: 'POST', body: JSON.stringify({ action: 'move-up' }) })}
          >
            ↑
          </button>
          <button
            className="inline-action"
            type="button"
            disabled={pending}
            onClick={() => run(`/api/admin/content/${node.id}`, { method: 'POST', body: JSON.stringify({ action: 'move-down' }) })}
          >
            ↓
          </button>
          <button
            className="inline-action inline-action-destructive"
            type="button"
            disabled={pending}
            onClick={() => run(`/api/admin/content/${node.id}`, { method: 'DELETE' })}
          >
            Remove
          </button>
        </div>
      </div>
      {kids.length > 0 ? (
        <div>
          {kids.map((k) => (
            <TreeNode
              key={k.id}
              node={k}
              childrenOf={childrenOf}
              selected={selected}
              onSelect={onSelect}
              pending={pending}
              run={run}
              addForm={addForm}
            />
          ))}
        </div>
      ) : null}
      {node.level !== 'page' ? (
        <div style={{ paddingLeft: node.depth * 18, paddingTop: 4 }}>{addForm(node)}</div>
      ) : null}
    </div>
  );
}

function TeaserField({
  node,
  pending,
  run,
}: {
  node: NodeRow;
  pending: boolean;
  run: (url: string, init: RequestInit) => Promise<boolean>;
}) {
  const [value, setValue] = useState(node.teaser ?? '');
  return (
    <form
      style={{ display: 'grid', gap: 6, maxWidth: 620 }}
      onSubmit={(e) => {
        e.preventDefault();
        run(`/api/admin/content/${node.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ teaser: value || null }),
        });
      }}
    >
      <label className="field">
        <span className="eyebrow">One line for someone who cannot read it yet</span>
        <input
          value={value}
          maxLength={300}
          onChange={(e) => setValue(e.target.value)}
          placeholder="How the plan match works and when you can join."
        />
        <span className="helper">
          Shown with the unlock date to anyone held back only by tenure. They never see
          the body.
        </span>
      </label>
      <div>
        <button className="inline-action" type="submit" disabled={pending}>
          Save this line
        </button>
      </div>
    </form>
  );
}
