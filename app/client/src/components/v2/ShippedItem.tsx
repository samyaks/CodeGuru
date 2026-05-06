import { useState } from 'react';
import {
  AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Clock, ExternalLink, GitCommit,
} from 'lucide-react';
import { Badge } from './Badge';

export type Verification = 'verified' | 'partial' | 'pending';

const COMMIT_MESSAGE_PREVIEW_CHARS = 25;

export interface ShippedItemData {
  id: string;
  title: string;
  commit: string;
  commitMessage: string;
  filesChanged?: number | string;
  verification: Verification;
  verificationDetail: string;
  partialItems?: string[];
  shippedAt: string;
  deployedTo?: string | null;
}

export interface ShippedItemProps {
  item: ShippedItemData;
  onReopenAsGap?: (id: string) => void;
  className?: string;
}

const VERIFICATION_META: Record<Verification, {
  label: string;
  icon: typeof CheckCircle;
  border: string;
  textClass: string;
}> = {
  verified: { label: 'Verified', icon: CheckCircle, border: 'border-emerald-200', textClass: 'text-emerald-600' },
  partial:  { label: 'Partial',  icon: AlertTriangle, border: 'border-amber-200',  textClass: 'text-amber-700' },
  pending:  { label: 'Verifying...', icon: Clock,    border: 'border-stone-200',  textClass: 'text-stone-600' },
};

export function ShippedItem({ item, onReopenAsGap, className = '' }: ShippedItemProps) {
  const meta = VERIFICATION_META[item.verification];
  const VIcon = meta.icon;
  const filesNumeric = typeof item.filesChanged === 'number' ? item.filesChanged : null;
  const fullMessage = (item.commitMessage || '').trim();
  // Use the first line for the inline preview so multi-line messages
  // don't blow up the single-row layout when collapsed.
  const firstLine = fullMessage.split('\n', 1)[0] ?? '';
  const isLong = fullMessage.length > COMMIT_MESSAGE_PREVIEW_CHARS
    || fullMessage.length > firstLine.length;
  const preview = firstLine.length > COMMIT_MESSAGE_PREVIEW_CHARS
    ? `${firstLine.slice(0, COMMIT_MESSAGE_PREVIEW_CHARS).trimEnd()}…`
    : firstLine;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-white border ${meta.border} rounded-lg p-5 ${className}`.trim()}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant={item.verification} icon={VIcon}>{meta.label}</Badge>
            <span className="text-xs text-stone-500">{item.shippedAt}</span>
            {item.deployedTo ? (
              <>
                <span className="text-xs text-stone-400">·</span>
                <span className="text-xs text-stone-500 flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> {item.deployedTo}
                </span>
              </>
            ) : null}
          </div>
          <h4 className="font-semibold text-stone-900 mb-1">{item.title}</h4>
        </div>
      </div>

      <div className="bg-stone-50 border border-stone-200 rounded-md p-3 mb-3">
        <div className="flex items-center gap-2 text-xs">
          <GitCommit className="w-3 h-3 text-stone-500 flex-shrink-0" />
          <span className="font-mono text-stone-700">{item.commit}</span>
          <span className="text-stone-400">·</span>
          {fullMessage ? (
            isLong ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                title={expanded ? 'Hide commit message' : 'Show full commit message'}
                className="text-stone-600 hover:text-stone-900 inline-flex items-center gap-1 min-w-0"
              >
                <span className="truncate">{expanded ? firstLine : preview}</span>
                {expanded
                  ? <ChevronUp className="w-3 h-3 flex-shrink-0" />
                  : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
              </button>
            ) : (
              <span className="text-stone-600 truncate">{fullMessage}</span>
            )
          ) : (
            <span className="text-stone-400 italic">no commit message</span>
          )}
          {filesNumeric !== null ? (
            <>
              <span className="text-stone-400">·</span>
              <span className="text-stone-500 flex-shrink-0">{filesNumeric} files</span>
            </>
          ) : null}
        </div>
        {expanded && isLong ? (
          <pre className="mt-2 text-xs text-stone-700 whitespace-pre-wrap break-words font-mono leading-relaxed">
            {fullMessage}
          </pre>
        ) : null}
      </div>

      <p className="text-xs text-stone-600 mb-3">
        <strong className={meta.textClass}>{meta.label}:</strong> {item.verificationDetail}
      </p>

      {item.verification === 'partial' && item.partialItems && item.partialItems.length > 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-3">
          <p className="text-xs font-semibold text-amber-900 mb-2">Still missing in:</p>
          <ul className="space-y-1">
            {item.partialItems.map((file) => (
              <li key={file} className="text-xs font-mono text-amber-800 flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-amber-500" />
                {file}
              </li>
            ))}
          </ul>
          {onReopenAsGap ? (
            <button
              type="button"
              onClick={() => onReopenAsGap(item.id)}
              className="text-xs text-amber-900 hover:text-amber-950 font-medium mt-2"
            >
              Re-open as new gap →
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ShippedItem;
