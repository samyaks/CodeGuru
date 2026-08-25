import { useState } from 'react';
import {
  AlertOctagon, Briefcase, Check, CheckCircle, ChevronDown, ChevronUp,
  Circle, Copy, ExternalLink, FileCode, GitCommit, Server, Shield, Sparkles, Users, Wand2, Wrench, X,
} from 'lucide-react';
import { Badge } from './Badge';

export type GapCategory = 'broken' | 'missing' | 'infra';
export type GapStatus = 'untriaged' | 'in-progress' | 'rejected' | 'shipped';
export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface GapAffectedJob {
  jobId: string;
  jobTitle: string;
  personaId: string | null;
  personaName: string | null;
  personaEmoji: string | null;
  confidence?: number | null;
  method?: string | null;
  reason?: string | null;
}

export interface GapData {
  id: string;
  category: GapCategory;
  title: string;
  description: string;
  effort?: string;
  files?: number;
  completion?: number;
  affects?: string[];
  required_for?: string[];
  prompt?: string | null;
  /** v2 enrichment: persona+job pairs the gap blocks. Server-side
   *  attached from `suggestions.v2_job_links` + the project's product
   *  map. Empty array means "linked, no jobs apply". When omitted, the
   *  card just falls back to the free-form `affects` strings. */
  affectedJobs?: GapAffectedJob[];
  /** 'ai' for persisted suggestions, 'map' for synthetic gaps generated
   *  from the product map's missing entities, 'security' for findings
   *  from the security detectors. `map` gaps don't have a cached
   *  `prompt`, don't accept Accept/Reject, and have a "Get Cursor
   *  prompt" affordance instead. `security` rows behave like `ai` for
   *  triage; the security lens is signaled by `isSecurity` instead. */
  source?: 'ai' | 'map' | 'security';
  /** File:line citations from the detector. Shown so the card is about
   *  this repo, not a generic template. */
  evidence?: Array<{
    file: string;
    line?: number | null;
    reason?: string | null;
    snippet?: string | null;
  }>;
  /** Security lens (Phase 1). Orthogonal to category — a gap can be
   *  Broken AND Security, or Missing-Infra AND Security. Backed by the
   *  v2 `suggestions.is_security` column. When true, the card renders a
   *  Shield badge next to the category badge. CWE is a compact link
   *  beside it; the shareable Security report owns the full write-up. */
  isSecurity?: boolean;
  securitySeverity?: SecuritySeverity | null;
  /** CWE identifier such as 'CWE-89'. Renders as a link to MITRE in
   *  the security callout when present. */
  cweId?: string | null;
  /** Name of the detector that flagged this gap (e.g.
   *  'sql-injection-patterns'). Surfaced in the callout for trust /
   *  debugging — the user gets to see the receipt, not just the
   *  verdict. */
  securityDetector?: string | null;
}

export interface GapCardProps {
  gap: GapData;
  status: GapStatus;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
  onRefine?: (id: string, instructions: string) => void;
  onMarkCommitted?: (id: string) => void;
  onCopyPrompt?: (id: string) => void;
  onRestore?: (id: string) => void;
  /** Map-derived gaps only: fetch the Cursor prompt on demand. The
   *  parent renders the prompt back into `gap.prompt` so this card
   *  shows it inline. */
  onGetPrompt?: (id: string) => void;
  /** External flag toggled true for ~2s after copy. */
  copied?: boolean;
  /** True while `onGetPrompt` is in flight for this card. */
  promptLoading?: boolean;
  className?: string;
}

const CATEGORY_META: Record<GapCategory, {
  label: string;
  icon: typeof AlertOctagon;
  border: string;
}> = {
  broken: { label: 'Broken', icon: AlertOctagon, border: 'border-red-200' },
  missing: { label: 'Missing Functionality', icon: Wrench, border: 'border-amber-200' },
  infra: { label: 'Missing Infrastructure', icon: Server, border: 'border-stone-300' },
};

// Severity colors for the Shield badge. Matches the spec exactly:
// critical=red-600, high=red-500, medium=amber-600, low=stone-600.
// The "low" tone uses a stone hue rather than green/blue so a low-sev
// security gap reads as "still a finding" — not "all clear".
const SECURITY_SEVERITY_META: Record<SecuritySeverity, {
  label: string;
  shieldClass: string;
}> = {
  critical: { label: 'Critical', shieldClass: 'bg-red-50 text-red-600 border-red-200' },
  high:     { label: 'High',     shieldClass: 'bg-red-50 text-red-500 border-red-100' },
  medium:   { label: 'Medium',   shieldClass: 'bg-amber-50 text-amber-700 border-amber-200' },
  low:      { label: 'Low',      shieldClass: 'bg-stone-100 text-stone-600 border-stone-200' },
};

function cweUrl(cweId: string): string {
  // CWE IDs are formatted "CWE-89"; MITRE wants the integer suffix.
  const m = /^CWE-(\d+)$/.exec(cweId.trim());
  if (!m) return 'https://cwe.mitre.org/';
  return `https://cwe.mitre.org/data/definitions/${m[1]}.html`;
}

export function GapCard({
  gap, status,
  onAccept, onReject, onRefine, onMarkCommitted, onCopyPrompt, onRestore, onGetPrompt,
  copied = false,
  promptLoading = false,
  className = '',
}: GapCardProps) {
  const meta = CATEGORY_META[gap.category];
  const Icon = meta.icon;
  const isInProgress = status === 'in-progress';
  const isRejected = status === 'rejected';
  const isUntriaged = status === 'untriaged';
  const isSynthetic = gap.source === 'map';
  const affectedJobs = Array.isArray(gap.affectedJobs) ? gap.affectedJobs : [];
  // Security tag (Phase 2 slice a). The flag is orthogonal to
  // category, so we read both — the category badge stays put and the
  // shield badge sits next to it. We only render security UI when the
  // severity is one of the four expected values; if the API ever
  // sends an unrecognized value we silently fall back to the
  // non-security shape rather than rendering a broken badge.
  const securityMeta = gap.isSecurity && gap.securitySeverity
    ? SECURITY_SEVERITY_META[gap.securitySeverity]
    : null;

  // The Cursor prompt block defaults collapsed. A user with N accepted
  // gaps would otherwise see N long prompts stacked open by default —
  // ~10× scroll cost for the common multi-gap triage flow. The Copy
  // button works without expanding, so collapse is the natural default.
  const [expanded, setExpanded] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineText, setRefineText] = useState('');

  const ringClass = isSynthetic
    ? 'border-stone-300 border-dashed'
    : isInProgress
      ? 'border-amber-300 ring-2 ring-amber-100'
      : isRejected
        ? 'border-stone-200 opacity-60'
        : meta.border;

  return (
    <div
      /* `gap-<id>` is the stable scroll target for deep-links from
         SecurityReport's "Fix this gap →" affordance. GapsSection
         reads `?focus=<gapId>` on mount, scrolls to this element,
         and toggles `data-focused` so we can ring it briefly. */
      id={`gap-${gap.id}`}
      data-gap-id={gap.id}
      className={`bg-white border ${ringClass} rounded-lg overflow-hidden transition-all hover:shadow-sm data-[focused=true]:ring-2 data-[focused=true]:ring-amber-400 data-[focused=true]:ring-offset-2 ${className}`.trim()}
    >
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Badge variant={gap.category} icon={Icon}>{meta.label}</Badge>
          {securityMeta ? (
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 ${securityMeta.shieldClass}`}
              title={`Security · ${securityMeta.label}${gap.cweId ? ` · ${gap.cweId}` : ''}${gap.securityDetector ? ` · detected by ${gap.securityDetector}` : ''}`}
              aria-label={`Security finding, ${securityMeta.label} severity${gap.cweId ? `, ${gap.cweId}` : ''}`}
            >
              <Shield className="w-3 h-3" aria-hidden /> Security · {securityMeta.label}
            </span>
          ) : null}
          {gap.cweId ? (
            <a
              href={cweUrl(gap.cweId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-stone-500 hover:text-stone-800 underline-offset-2 hover:underline"
              title="View this CWE on MITRE"
            >
              {gap.cweId}
              <ExternalLink className="w-2.5 h-2.5 inline-block ml-0.5 -mt-0.5" aria-hidden />
            </a>
          ) : null}
          {isSynthetic ? (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-stone-500 bg-stone-100 border border-stone-200 rounded-full px-2 py-0.5">
              <Sparkles className="w-2.5 h-2.5" /> From Map
            </span>
          ) : null}
          {isInProgress ? (
            <Badge variant="in-progress" icon={Circle}>In progress</Badge>
          ) : null}
          {isRejected ? (
            <Badge variant="rejected" icon={X}>Rejected</Badge>
          ) : null}
          {gap.effort ? (
            <>
              <span className="text-xs text-stone-500">·</span>
              <span className="text-xs text-stone-500">{gap.effort} effort</span>
            </>
          ) : null}
          {typeof gap.files === 'number' && !(Array.isArray(gap.evidence) && gap.evidence.length > 0) ? (
            <>
              <span className="text-xs text-stone-500">·</span>
              <span className="text-xs text-stone-500">{gap.files} files</span>
            </>
          ) : null}
          {typeof gap.completion === 'number' ? (
            <>
              <span className="text-xs text-stone-500">·</span>
              <span className="text-xs text-stone-500">{gap.completion}% built</span>
            </>
          ) : null}
        </div>

        <h4 className="font-semibold text-stone-900 mb-1.5">{gap.title}</h4>
        <p className="text-sm text-stone-600 leading-relaxed mb-3">{gap.description}</p>

        {Array.isArray(gap.evidence) && gap.evidence.length > 0 ? (
          <div className="mb-3 space-y-1">
            {gap.evidence.slice(0, 5).map((e, i) => (
              <div
                key={`${e.file}:${e.line ?? ''}:${i}`}
                title={e.reason ?? undefined}
                className="flex items-start gap-1.5 text-[11px] font-mono text-stone-500"
              >
                <FileCode className="w-3 h-3 mt-0.5 flex-shrink-0 text-stone-400" aria-hidden />
                <span className="text-stone-700">{e.file}{typeof e.line === 'number' ? `:${e.line}` : ''}</span>
              </div>
            ))}
            {gap.evidence.length > 5 ? (
              <p className="text-[11px] text-stone-400 pl-4">+{gap.evidence.length - 5} more</p>
            ) : null}
          </div>
        ) : null}

        {affectedJobs.length > 0 ? (
          <div className="flex items-start gap-2 text-xs mb-4">
            <Users className="w-3 h-3 text-stone-400 mt-0.5 flex-shrink-0" />
            <div className="flex flex-wrap gap-1.5">
              {affectedJobs.map((j) => (
                <span
                  key={`${j.personaId ?? 'no-persona'}-${j.jobId}`}
                  title={j.reason ?? `Blocks "${j.jobTitle}"`}
                  className="inline-flex items-center gap-1 bg-stone-100 border border-stone-200 rounded-full px-2 py-0.5 text-stone-700"
                >
                  <span aria-hidden>{j.personaEmoji || '👤'}</span>
                  <span className="font-medium">{j.personaName || 'Persona'}</span>
                  <span className="text-stone-400">·</span>
                  <span className="text-stone-600">{j.jobTitle}</span>
                </span>
              ))}
            </div>
          </div>
        ) : gap.affects && gap.affects.length > 0 ? (
          <div className="flex items-center gap-2 text-xs text-stone-500 mb-4">
            <Users className="w-3 h-3" />
            <span>Blocks: {gap.affects.join(', ')}</span>
          </div>
        ) : null}
        {gap.required_for && gap.required_for.length > 0 && affectedJobs.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-stone-500 mb-4">
            <Briefcase className="w-3 h-3" />
            <span>Required for: {gap.required_for.join(' · ')}</span>
          </div>
        ) : null}

        {isInProgress ? (
          <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-widest text-stone-500 font-semibold">Cursor prompt</p>
              {gap.prompt ? (
                <button
                  type="button"
                  onClick={() => setExpanded((x) => !x)}
                  className="text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1"
                >
                  {expanded ? <>Hide <ChevronUp className="w-3 h-3" /></> : <>Show <ChevronDown className="w-3 h-3" /></>}
                </button>
              ) : null}
            </div>

            {expanded && gap.prompt ? (
              <div className="bg-stone-900 rounded-md p-4 max-h-60 overflow-y-auto">
                <pre className="text-xs text-stone-300 whitespace-pre-wrap font-mono leading-relaxed">{gap.prompt}</pre>
              </div>
            ) : null}

            <div className="flex items-center gap-2 flex-wrap">
              {gap.prompt ? (
                <button
                  type="button"
                  onClick={() => onCopyPrompt?.(gap.id)}
                  className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-md text-sm font-medium transition-colors"
                >
                  {copied ? (<><CheckCircle className="w-4 h-4" /> Copied</>) : (<><Copy className="w-4 h-4" /> Copy prompt</>)}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onGetPrompt?.(gap.id)}
                  disabled={promptLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 text-white rounded-md text-sm font-medium transition-colors"
                >
                  <Sparkles className="w-4 h-4" /> {promptLoading ? 'Generating…' : 'Get Cursor prompt'}
                </button>
              )}
              {/* `Mark committed` keeps `ml-auto` so it right-aligns on
                  desktop. On narrow viewports the wrap from `flex-wrap`
                  drops it to the next line where ml-auto effectively
                  becomes a no-op — still readable, just stacked. */}
              <button
                type="button"
                onClick={() => onMarkCommitted?.(gap.id)}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-medium transition-colors ml-auto"
              >
                <GitCommit className="w-4 h-4" /> Mark committed
              </button>
            </div>
            <p className="text-xs text-stone-500 italic">After you commit, Takeoff will re-scan the affected files and verify the gap is resolved.</p>
          </div>
        ) : null}

        {refining && isUntriaged ? (
          <div className="mt-4 p-3 bg-stone-50 border border-stone-200 rounded-md">
            <p className="text-xs text-stone-600 mb-2 font-medium">How should we reshape this gap?</p>
            <textarea
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              placeholder="e.g. 'Scope smaller — just protect /api/auth endpoints first'"
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded focus:outline-none focus:border-stone-900 mb-2 resize-none"
              rows={2}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setRefining(false); setRefineText(''); }}
                className="text-xs text-stone-600 hover:text-stone-900 px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onRefine?.(gap.id, refineText);
                  setRefining(false);
                  setRefineText('');
                }}
                disabled={!refineText.trim()}
                className="text-xs bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white px-3 py-1.5 rounded font-medium"
              >
                Regenerate
              </button>
            </div>
          </div>
        ) : null}

        {isUntriaged && !refining && isSynthetic ? (
          gap.prompt ? (
            <div className="mt-2 space-y-3">
              <div className="bg-stone-900 rounded-md p-4 max-h-60 overflow-y-auto">
                <pre className="text-xs text-stone-300 whitespace-pre-wrap font-mono leading-relaxed">{gap.prompt}</pre>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => onCopyPrompt?.(gap.id)}
                  className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-md text-sm font-medium transition-colors"
                >
                  {copied ? (<><CheckCircle className="w-4 h-4" /> Copied</>) : (<><Copy className="w-4 h-4" /> Copy prompt</>)}
                </button>
                <span className="text-xs text-stone-500 italic">
                  Build it, push, and Takeoff will detect the entity is built — this gap will disappear.
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => onGetPrompt?.(gap.id)}
                disabled={promptLoading}
                className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 text-white rounded-md text-sm font-medium transition-colors"
              >
                <Sparkles className="w-4 h-4" /> {promptLoading ? 'Generating…' : 'Get Cursor prompt'}
              </button>
              <span className="text-xs text-stone-500 italic">
                We only call Claude if you ask — saves your tokens.
              </span>
            </div>
          )
        ) : null}

        {isUntriaged && !refining && !isSynthetic ? (
          /* Hierarchy: Accept is the primary action (the GapsSection
             copy says "Accept gaps to start working on them"), so it
             gets the solid black treatment. Reject and Refine are
             quiet ghost buttons — no border, no fill — so the eye
             lands on Accept first. Padding stays consistent so the
             three are still recognizable as a button group. */
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => onAccept?.(gap.id)}
              className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-md text-sm font-medium transition-colors"
            >
              <Check className="w-4 h-4" /> Accept
            </button>
            <button
              type="button"
              onClick={() => onReject?.(gap.id)}
              className="flex items-center gap-2 px-3 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-md text-sm font-medium transition-colors"
            >
              <X className="w-4 h-4" /> Reject
            </button>
            <button
              type="button"
              onClick={() => setRefining(true)}
              className="flex items-center gap-2 px-3 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-md text-sm font-medium transition-colors"
            >
              <Wand2 className="w-4 h-4" /> Refine
            </button>
          </div>
        ) : null}

        {isRejected ? (
          <button
            type="button"
            onClick={() => onRestore?.(gap.id)}
            className="text-xs text-stone-600 hover:text-stone-900 font-medium"
          >
            Restore this gap
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default GapCard;
