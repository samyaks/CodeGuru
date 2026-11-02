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
  behavior: { label: 'Behavior', pill: 'bg-paper-sunk text-ink border-line' },
  constraint: { label: 'Constraint', pill: 'bg-holding-soft text-holding border-holding' },
  non_goal: { label: 'Non-goal', pill: 'bg-paper-sunk text-ink-muted border-line' },
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
  needs_relink: { chip: 'bg-holding-soft border-holding text-holding', icon: AlertTriangle, label: 'needs relink' },
  broken: { chip: 'bg-grounded-soft border-grounded text-grounded', icon: Unlink, label: 'broken link' },
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

// Small pill that sits next to a link chip when reconciliation (Phase 5) has
// flagged the anchor. `needs_relink` also surfaces the reconciler's suggested
// symbol inline so the reviewer can see the proposed fix at a glance.
function LinkHealthBadge({ link }: { link: IntentLink }) {
  if (link.linkStatus === 'healthy') return null;
  const meta = LINK_HEALTH_META[link.linkStatus];
  const HealthIcon = meta.icon;
  const suggests = link.linkStatus === 'needs_relink' && link.suggestedSymbol;
  return (
    <span
      className={`text-[10px] font-semibold border rounded-full px-1.5 py-0.5 inline-flex items-center gap-1 ${meta.chip}`}
      aria-label={`${anchorLabel(link)} — ${meta.label}${suggests ? `, suggested ${link.suggestedSymbol}` : ''}`}
    >
      <HealthIcon className="w-3 h-3 flex-shrink-0" aria-hidden />
      {meta.label}
      {suggests ? <span className="font-mono">{`\u2192 ${link.suggestedSymbol}`}</span> : null}
    </span>
  );
}

function LinkChip({ link, showHealth }: { link: IntentLink; showHealth: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <code
        className="text-xs px-2 py-1 rounded border font-mono inline-flex items-center gap-1 bg-paper-sunk border-line text-ink"
        title={anchorLabel(link)}
      >
        <span className="text-ink-muted">{link.filePath}</span>
        {link.symbol ? <span className="text-ink-muted">·</span> : null}
        {link.symbol ? <span>{link.symbol}</span> : null}
      </code>
      {showHealth ? <LinkHealthBadge link={link} /> : null}
    </span>
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

  // Satisfaction badge (Phase 6). Only meaningful on confirmed statements, and
  // hidden entirely until a baseline check populates `satisfied` — null means
  // "not yet checked".
  const satisfactionBadge = !isConfirmed || statement.satisfied === null ? null : statement.satisfied ? (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 bg-cleared-soft text-cleared border-cleared"
      title="The code still satisfies this statement"
    >
      <CircleCheck className="w-3 h-3" aria-hidden /> Satisfied
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 bg-grounded-soft text-grounded border-grounded"
      title="The code no longer satisfies this statement"
    >
      <CircleSlash className="w-3 h-3" aria-hidden /> Drifted
    </span>
  );

  const cardTone = isRejected
    ? 'border-line opacity-70'
    : isConfirmed
      ? 'border-cleared'
      : 'border-line';

  return (
    <div className={`bg-paper-raised border ${cardTone} rounded-lg overflow-hidden ${className}`.trim()}>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
          <span
            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium ${kindMeta.pill}`}
          >
            {kindMeta.label}
          </span>
          {isCandidate ? (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium bg-holding-soft text-holding border-holding">
              Needs review
            </span>
          ) : isConfirmed ? (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium bg-cleared-soft text-cleared border-cleared">
              Confirmed
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium bg-paper-sunk text-ink-muted border-line">
              Rejected
            </span>
          )}
          {statement.source === 'human' ? (
            <span className="text-[10px] uppercase tracking-wider text-ink-muted">Edited by you</span>
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
              className="w-full px-3 py-2 text-sm border border-line-strong rounded focus:outline-none focus:border-line-strong resize-none v2-font-serif"
            />
            <div className="flex items-center gap-2">
              <label htmlFor={`kind-${statement.id}`} className="text-xs text-ink-muted">Kind</label>
              <select
                id={`kind-${statement.id}`}
                value={draftKind}
                onChange={(e) => setDraftKind(e.target.value as IntentKind)}
                className="text-xs px-2 py-1 border border-line-strong rounded focus:outline-none focus:border-line-strong bg-paper-raised"
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>{KIND_META[k].label}</option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-muted mb-1.5">Linked code</p>
              {draftLinks.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {draftLinks.map((l, idx) => (
                    <span
                      key={`${l.filePath}-${l.symbol ?? ''}-${idx}`}
                      className="text-xs px-2 py-1 rounded border bg-paper-sunk border-line text-ink font-mono inline-flex items-center gap-1.5"
                    >
                      <span className="text-ink-muted">{l.filePath}</span>
                      {l.symbol ? <span className="text-ink-muted">·</span> : null}
                      {l.symbol ? <span>{l.symbol}</span> : null}
                      <button
                        type="button"
                        onClick={() => removeLink(idx)}
                        aria-label={`Remove link ${anchorLabel({ ...l, linkStatus: 'healthy' })}`}
                        className="text-ink-muted hover:text-grounded transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink-muted mb-2">No linked code.</p>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
                  placeholder="path/to/file.ts"
                  aria-label="Link file path"
                  className="text-xs px-2 py-1 border border-line-strong rounded focus:outline-none focus:border-line-strong font-mono flex-1 min-w-[8rem]"
                />
                <input
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
                  placeholder="symbol (optional)"
                  aria-label="Link symbol"
                  className="text-xs px-2 py-1 border border-line-strong rounded focus:outline-none focus:border-line-strong font-mono flex-1 min-w-[7rem]"
                />
                <button
                  type="button"
                  onClick={addLink}
                  disabled={!newFilePath.trim()}
                  aria-label="Add link"
                  className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-line-strong text-ink hover:bg-paper-sunk disabled:opacity-40 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-ink-muted hover:text-ink px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy || !draftText.trim()}
                className="text-xs bg-night hover:bg-night disabled:bg-line-strong text-on-night px-3 py-1.5 rounded font-medium"
              >
                Save changes
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-ink leading-relaxed v2-font-serif mb-3">{statement.text}</p>

            {statement.links.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {statement.links.map((l, idx) => (
                  <LinkChip key={`${l.filePath}-${l.symbol ?? ''}-${idx}`} link={l} showHealth={showLinkHealth} />
                ))}
              </div>
            ) : null}

            {/* Each control renders only when its handler is supplied, so a
                read-only parent (signed-out visitor) gets a card with no
                actions rather than buttons that silently do nothing. */}
            {(isRejected ? onRestore : (onAccept || onEdit || onReject)) ? (
              <div className="flex items-center gap-1 flex-wrap">
                {isRejected ? (
                  <button
                    type="button"
                    onClick={() => onRestore?.(statement.id)}
                    disabled={busy}
                    aria-label="Restore statement"
                    className="flex items-center gap-2 px-3 py-1.5 text-ink-muted hover:text-ink hover:bg-paper-sunk disabled:opacity-40 rounded-md text-sm font-medium transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" /> Restore
                  </button>
                ) : (
                  <>
                    {!isConfirmed && onAccept ? (
                      <button
                        type="button"
                        onClick={() => onAccept(statement.id)}
                        disabled={busy}
                        aria-label="Accept statement"
                        className="flex items-center gap-2 px-4 py-1.5 bg-night hover:bg-night disabled:bg-line-strong text-on-night rounded-md text-sm font-medium transition-colors"
                      >
                        <Check className="w-4 h-4" /> Accept
                      </button>
                    ) : null}
                    {onEdit ? (
                      <button
                        type="button"
                        onClick={openEditor}
                        disabled={busy}
                        aria-label="Edit statement"
                        className="flex items-center gap-2 px-3 py-1.5 text-ink-muted hover:text-ink hover:bg-paper-sunk disabled:opacity-40 rounded-md text-sm font-medium transition-colors"
                      >
                        <Pencil className="w-4 h-4" /> Edit
                      </button>
                    ) : null}
                    {onReject ? (
                      <button
                        type="button"
                        onClick={() => onReject(statement.id)}
                        disabled={busy}
                        aria-label="Reject statement"
                        className="flex items-center gap-2 px-3 py-1.5 text-ink-muted hover:text-ink hover:bg-paper-sunk disabled:opacity-40 rounded-md text-sm font-medium transition-colors"
                      >
                        <X className="w-4 h-4" /> Reject
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default IntentStatementCard;
