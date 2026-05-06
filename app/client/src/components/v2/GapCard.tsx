import { useState } from 'react';
import {
  AlertOctagon, Briefcase, Check, CheckCircle, ChevronDown, ChevronUp,
  Circle, Copy, ExternalLink, GitCommit, Server, Sparkles, Users, Wand2, Wrench, X,
} from 'lucide-react';
import { Badge } from './Badge';

export type GapCategory = 'broken' | 'missing' | 'infra';
export type GapStatus = 'untriaged' | 'in-progress' | 'rejected' | 'shipped';

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
   *  from the product map's missing entities. The latter don't have a
   *  cached `prompt`, don't accept Accept/Reject, and have a "Get
   *  Cursor prompt" affordance instead. */
  source?: 'ai' | 'map';
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
  onOpenInCursor?: (id: string) => void;
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

export function GapCard({
  gap, status,
  onAccept, onReject, onRefine, onMarkCommitted, onCopyPrompt, onRestore, onOpenInCursor, onGetPrompt,
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

  const [expanded, setExpanded] = useState(true);
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
    <div className={`bg-white border ${ringClass} rounded-lg overflow-hidden transition-all hover:shadow-sm ${className}`.trim()}>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Badge variant={gap.category} icon={Icon}>{meta.label}</Badge>
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
          {typeof gap.files === 'number' ? (
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
              <button
                type="button"
                onClick={() => setExpanded((x) => !x)}
                className="text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1"
              >
                {expanded ? <>Hide <ChevronUp className="w-3 h-3" /></> : <>Show <ChevronDown className="w-3 h-3" /></>}
              </button>
            </div>

            {expanded && gap.prompt ? (
              <div className="bg-stone-900 rounded-md p-4 max-h-60 overflow-y-auto">
                <pre className="text-xs text-stone-300 whitespace-pre-wrap font-mono leading-relaxed">{gap.prompt}</pre>
              </div>
            ) : null}

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => onCopyPrompt?.(gap.id)}
                className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-md text-sm font-medium transition-colors"
              >
                {copied ? (<><CheckCircle className="w-4 h-4" /> Copied</>) : (<><Copy className="w-4 h-4" /> Copy prompt</>)}
              </button>
              {onOpenInCursor ? (
                <button
                  type="button"
                  onClick={() => onOpenInCursor(gap.id)}
                  className="flex items-center gap-2 px-4 py-2 border border-stone-300 hover:bg-stone-50 text-stone-700 rounded-md text-sm font-medium transition-colors"
                >
                  <ExternalLink className="w-4 h-4" /> Open in Cursor
                </button>
              ) : null}
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
            <p className="text-xs text-stone-600 mb-2 font-medium">Tell Claude how to reshape this gap:</p>
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
          <div className="flex items-center gap-2">
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
              className="flex items-center gap-2 px-4 py-2 border border-stone-300 hover:bg-stone-50 text-stone-700 rounded-md text-sm font-medium transition-colors"
            >
              <X className="w-4 h-4" /> Reject
            </button>
            <button
              type="button"
              onClick={() => setRefining(true)}
              className="flex items-center gap-2 px-4 py-2 border border-stone-300 hover:bg-stone-50 text-stone-700 rounded-md text-sm font-medium transition-colors"
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
