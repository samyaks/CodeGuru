import { useState } from 'react';
import {
  Check, Pencil, X, RotateCcw, Plus, AlertTriangle, Unlink, CircleCheck, CircleSlash,
} from 'lucide-react';
import type {
  IntentStatement, IntentKind, IntentEditPayload, IntentLink,
} from '../../services/intentApi';

// Kind pill palette. `behavior` is the neutral default (stone), `constraint`
// is a guardrail so it earns the amber accent, and `non_goal` is deliberately
// muted — it's an explicit "we're NOT doing this" and shouldn't shout.
const KIND_META: Record<IntentKind, { label: string; pill: string }> = {
  behavior: { label: 'Behavior', pill: 'bg-stone-100 text-stone-700 border-stone-200' },
  constraint: { label: 'Constraint', pill: 'bg-amber-50 text-amber-700 border-amber-200' },
  non_goal: { label: 'Non-goal', pill: 'bg-stone-50 text-stone-400 border-stone-200' },
};

const KIND_OPTIONS: IntentKind[] = ['behavior', 'constraint', 'non_goal'];

// Link-health decoration (Phase 5). `healthy` links render as plain chips; the
// other two states earn an inline icon + tint so a reviewer can spot a stale
// anchor without leaving the card. Absent until reconciliation runs.
const LINK_HEALTH_META: Record<Exclude<IntentLink['linkStatus'], 'healthy'>, {
  chip: string;
  icon: typeof AlertTriangle;
  label: string;
}> = {
  needs_relink: { chip: 'bg-amber-50 border-amber-200 text-amber-700', icon: AlertTriangle, label: 'needs relink' },
  broken: { chip: 'bg-red-50 border-red-200 text-red-600', icon: Unlink, label: 'broken link' },
};

function anchorLabel(link: IntentLink): string {
  return link.symbol ? `${link.filePath} · ${link.symbol}` : link.filePath;
}

export interface IntentStatementCardProps {
  statement: IntentStatement;
  /** Disables all controls while a mutation for this statement is in flight. */
  busy?: boolean;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
  onRestore?: (id: string) => void;
  onEdit?: (id: string, payload: IntentEditPayload) => void;
  /** Optional link-health rendering (Phase 5). Off by default so the card is
   *  complete without reconciliation data. */
  showLinkHealth?: boolean;
  className?: string;
}

function LinkChip({ link, showHealth }: { link: IntentLink; showHealth: boolean }) {
  const unhealthy = showHealth && link.linkStatus !== 'healthy'
    ? LINK_HEALTH_META[link.linkStatus]
    : null;
  const HealthIcon = unhealthy?.icon;
  return (
    <code
      className={`text-xs px-2 py-1 rounded border font-mono inline-flex items-center gap-1 ${
        unhealthy ? unhealthy.chip : 'bg-stone-50 border-stone-200 text-stone-700'
      }`}
      title={unhealthy ? `${anchorLabel(link)} — ${unhealthy.label}${link.suggestedSymbol ? `, suggested: ${link.suggestedSymbol}` : ''}` : anchorLabel(link)}
    >
      {HealthIcon ? <HealthIcon className="w-3 h-3 flex-shrink-0" aria-hidden /> : null}
      <span className="text-stone-500">{link.filePath}</span>
      {link.symbol ? <span className="text-stone-400">·</span> : null}
      {link.symbol ? <span>{link.symbol}</span> : null}
    </code>
  );
}

export function IntentStatementCard({
  statement,
  busy = false,
  onAccept,
  onReject,
  onRestore,
  onEdit,
  showLinkHealth = false,
  className = '',
}: IntentStatementCardProps) {
  const isConfirmed = statement.status === 'confirmed';
  const isRejected = statement.status === 'rejected';
  const isCandidate = statement.status === 'candidate';

  const kindMeta = KIND_META[statement.kind];

  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(statement.text);
  const [draftKind, setDraftKind] = useState<IntentKind>(statement.kind);
  const [draftLinks, setDraftLinks] = useState<Array<{ filePath: string; symbol: string | null }>>(
    statement.links.map((l) => ({ filePath: l.filePath, symbol: l.symbol })),
  );
  const [newFilePath, setNewFilePath] = useState('');
  const [newSymbol, setNewSymbol] = useState('');

  const openEditor = () => {
    setDraftText(statement.text);
    setDraftKind(statement.kind);
    setDraftLinks(statement.links.map((l) => ({ filePath: l.filePath, symbol: l.symbol })));
    setNewFilePath('');
    setNewSymbol('');
    setEditing(true);
  };

  const addLink = () => {
    const filePath = newFilePath.trim();
    if (!filePath) return;
    const symbol = newSymbol.trim() || null;
    setDraftLinks((prev) => [...prev, { filePath, symbol }]);
    setNewFilePath('');
    setNewSymbol('');
  };

  const removeLink = (idx: number) => {
    setDraftLinks((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveEdit = () => {
    const text = draftText.trim();
    if (!text) return;
    onEdit?.(statement.id, { text, kind: draftKind, links: draftLinks });
    setEditing(false);
  };

  // Satisfaction badge (Phase 6). Hidden entirely until a baseline check
  // populates `satisfied` — null means "not yet checked".
  const satisfactionBadge = statement.satisfied === null ? null : statement.satisfied ? (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 border-emerald-200"
      title="The code still satisfies this statement"
    >
      <CircleCheck className="w-3 h-3" aria-hidden /> Satisfied
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 bg-red-50 text-red-600 border-red-200"
      title="The code no longer satisfies this statement"
    >
      <CircleSlash className="w-3 h-3" aria-hidden /> Drifted
    </span>
  );

  const cardTone = isRejected
    ? 'border-stone-200 opacity-70'
    : isConfirmed
      ? 'border-emerald-200'
      : 'border-stone-200';

  return (
    <div className={`bg-white border ${cardTone} rounded-lg overflow-hidden ${className}`.trim()}>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
          <span
            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium ${kindMeta.pill}`}
          >
            {kindMeta.label}
          </span>
          {isCandidate ? (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium bg-amber-50 text-amber-700 border-amber-200">
              Needs review
            </span>
          ) : isConfirmed ? (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
              Confirmed
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium bg-stone-100 text-stone-500 border-stone-200">
              Rejected
            </span>
          )}
          {statement.source === 'human' ? (
            <span className="text-[10px] uppercase tracking-wider text-stone-400">Edited by you</span>
          ) : null}
          {satisfactionBadge ? <span className="ml-auto">{satisfactionBadge}</span> : null}
        </div>

        {editing ? (
          <div className="space-y-3">
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              rows={3}
              aria-label="Statement text"
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded focus:outline-none focus:border-stone-900 resize-none v2-font-serif"
            />
            <div className="flex items-center gap-2">
              <label htmlFor={`kind-${statement.id}`} className="text-xs text-stone-500">Kind</label>
              <select
                id={`kind-${statement.id}`}
                value={draftKind}
                onChange={(e) => setDraftKind(e.target.value as IntentKind)}
                className="text-xs px-2 py-1 border border-stone-300 rounded focus:outline-none focus:border-stone-900 bg-white"
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>{KIND_META[k].label}</option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider text-stone-500 mb-1.5">Linked code</p>
              {draftLinks.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {draftLinks.map((l, idx) => (
                    <span
                      key={`${l.filePath}-${l.symbol ?? ''}-${idx}`}
                      className="text-xs px-2 py-1 rounded border bg-stone-50 border-stone-200 text-stone-700 font-mono inline-flex items-center gap-1.5"
                    >
                      <span className="text-stone-500">{l.filePath}</span>
                      {l.symbol ? <span className="text-stone-400">·</span> : null}
                      {l.symbol ? <span>{l.symbol}</span> : null}
                      <button
                        type="button"
                        onClick={() => removeLink(idx)}
                        aria-label={`Remove link ${anchorLabel({ ...l, linkStatus: 'healthy' })}`}
                        className="text-stone-400 hover:text-red-600 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-stone-400 mb-2">No linked code.</p>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
                  placeholder="path/to/file.ts"
                  aria-label="Link file path"
                  className="text-xs px-2 py-1 border border-stone-300 rounded focus:outline-none focus:border-stone-900 font-mono flex-1 min-w-[8rem]"
                />
                <input
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
                  placeholder="symbol (optional)"
                  aria-label="Link symbol"
                  className="text-xs px-2 py-1 border border-stone-300 rounded focus:outline-none focus:border-stone-900 font-mono flex-1 min-w-[7rem]"
                />
                <button
                  type="button"
                  onClick={addLink}
                  disabled={!newFilePath.trim()}
                  aria-label="Add link"
                  className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-stone-300 text-stone-700 hover:bg-stone-100 disabled:opacity-40 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-stone-600 hover:text-stone-900 px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy || !draftText.trim()}
                className="text-xs bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white px-3 py-1.5 rounded font-medium"
              >
                Save changes
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-stone-800 leading-relaxed v2-font-serif mb-3">{statement.text}</p>

            {statement.links.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {statement.links.map((l, idx) => (
                  <LinkChip key={`${l.filePath}-${l.symbol ?? ''}-${idx}`} link={l} showHealth={showLinkHealth} />
                ))}
              </div>
            ) : null}

            <div className="flex items-center gap-1 flex-wrap">
              {isRejected ? (
                <button
                  type="button"
                  onClick={() => onRestore?.(statement.id)}
                  disabled={busy}
                  aria-label="Restore statement"
                  className="flex items-center gap-2 px-3 py-1.5 text-stone-600 hover:text-stone-900 hover:bg-stone-100 disabled:opacity-40 rounded-md text-sm font-medium transition-colors"
                >
                  <RotateCcw className="w-4 h-4" /> Restore
                </button>
              ) : (
                <>
                  {!isConfirmed ? (
                    <button
                      type="button"
                      onClick={() => onAccept?.(statement.id)}
                      disabled={busy}
                      aria-label="Accept statement"
                      className="flex items-center gap-2 px-4 py-1.5 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white rounded-md text-sm font-medium transition-colors"
                    >
                      <Check className="w-4 h-4" /> Accept
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={openEditor}
                    disabled={busy}
                    aria-label="Edit statement"
                    className="flex items-center gap-2 px-3 py-1.5 text-stone-600 hover:text-stone-900 hover:bg-stone-100 disabled:opacity-40 rounded-md text-sm font-medium transition-colors"
                  >
                    <Pencil className="w-4 h-4" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onReject?.(statement.id)}
                    disabled={busy}
                    aria-label="Reject statement"
                    className="flex items-center gap-2 px-3 py-1.5 text-stone-600 hover:text-stone-900 hover:bg-stone-100 disabled:opacity-40 rounded-md text-sm font-medium transition-colors"
                  >
                    <X className="w-4 h-4" /> Reject
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default IntentStatementCard;
