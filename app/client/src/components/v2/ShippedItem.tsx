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
  verified: { label: 'Verified', icon: CheckCircle, border: 'border-cleared', textClass: 'text-cleared' },
  partial:  { label: 'Partial',  icon: AlertTriangle, border: 'border-holding',  textClass: 'text-holding' },
  pending:  { label: 'Verifying...', icon: Clock,    border: 'border-line',  textClass: 'text-ink-muted' },
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
    <div className={`bg-paper-raised border ${meta.border} rounded-lg p-5 ${className}`.trim()}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant={item.verification} icon={VIcon}>{meta.label}</Badge>
            <span className="text-xs text-ink-muted">{item.shippedAt}</span>
            {item.deployedTo ? (
              <>
                <span className="text-xs text-ink-muted">·</span>
                <span className="text-xs text-ink-muted flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> {item.deployedTo}
                </span>
              </>
            ) : null}
          </div>
          <h4 className="font-semibold text-ink mb-1">{item.title}</h4>
        </div>
      </div>

      <div className="bg-paper-sunk border border-line rounded-md p-3 mb-3">
        <div className="flex items-center gap-2 text-xs">
          <GitCommit className="w-3 h-3 text-ink-muted flex-shrink-0" />
          <span className="font-mono text-ink">{item.commit}</span>
          <span className="text-ink-muted">·</span>
          {fullMessage ? (
            isLong ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                title={expanded ? 'Hide commit message' : 'Show full commit message'}
                className="text-ink-muted hover:text-ink inline-flex items-center gap-1 min-w-0"
              >
                <span className="truncate">{expanded ? firstLine : preview}</span>
                {expanded
                  ? <ChevronUp className="w-3 h-3 flex-shrink-0" />
                  : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
              </button>
            ) : (
              <span className="text-ink-muted truncate">{fullMessage}</span>
            )
          ) : (
            <span className="text-ink-muted italic">no commit message</span>
          )}
          {filesNumeric !== null ? (
            <>
              <span className="text-ink-muted">·</span>
              <span className="text-ink-muted flex-shrink-0">{filesNumeric} files</span>
            </>
          ) : null}
        </div>
        {expanded && isLong ? (
          <pre className="mt-2 text-xs text-ink whitespace-pre-wrap break-words font-mono leading-relaxed">
            {fullMessage}
          </pre>
        ) : null}
      </div>

      <p className="text-xs text-ink-muted mb-3">
        <strong className={meta.textClass}>{meta.label}:</strong> {item.verificationDetail}
      </p>

      {item.verification === 'partial' && item.partialItems && item.partialItems.length > 0 ? (
        <div className="bg-holding-soft border border-holding rounded-md p-3 mb-3">
          <p className="text-xs font-semibold text-holding mb-2">Still missing in:</p>
          <ul className="space-y-1">
            {item.partialItems.map((file) => (
              <li key={file} className="text-xs font-mono text-holding flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-holding" />
                {file}
              </li>
            ))}
          </ul>
          {onReopenAsGap ? (
            <button
              type="button"
              onClick={() => onReopenAsGap(item.id)}
              className="text-xs text-holding hover:text-holding font-medium mt-2"
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
