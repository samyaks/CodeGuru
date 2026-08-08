import { useEffect, useRef, useState } from 'react';
import type { ReadClaim } from '../../services/readApi';

/** True when the claim gets the yellow-wash "we're unsure" treatment. */
export function isUncertain(claim: ReadClaim): boolean {
  return (
    claim.status !== 'settled' &&
    claim.confidence !== null &&
    claim.confidence < 0.6 &&
    claim.alternative !== null &&
    claim.alternative.options.length > 0
  );
}

const SLOT_LABELS: Record<ReadClaim['slot'], string> = {
  objective: 'Edit the objective',
  audience: "Edit who it's for",
  core_job: 'Edit the core job',
};

interface ClaimPhraseProps {
  claim: ReadClaim;
  /** Uncertain claims open the alternative editor instead of inline editing. */
  onOpenPop: () => void;
  /** Free-text commit. Resolves false if the save failed (text reverts). */
  onCommitText: (text: string) => Promise<boolean>;
  saving: boolean;
}

/**
 * One claim rendered inline in the sentence.
 * - uncertain → `.editable` yellow wash; click opens the editor pop
 * - otherwise → `.etext`; click makes the phrase contenteditable in place,
 *   Enter/blur commits, Escape cancels
 */
export default function ClaimPhrase({ claim, onOpenPop, onCommitText, saving }: ClaimPhraseProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);
  const origRef = useRef('');
  const uncertain = isUncertain(claim);

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  function begin() {
    if (editing || saving) return;
    if (uncertain) {
      onOpenPop();
      return;
    }
    origRef.current = ref.current?.textContent ?? claim.text;
    setEditing(true);
  }

  function restore() {
    const el = ref.current;
    if (el) el.textContent = origRef.current;
  }

  function commit() {
    if (!editing) return;
    setEditing(false);
    const el = ref.current;
    if (!el) return;
    const next = (el.textContent ?? '').trim();
    const orig = origRef.current.trim();
    if (next === '' || next === orig) {
      restore();
      return;
    }
    void onCommitText(next).then((ok) => {
      if (!ok) restore();
    });
  }

  function cancel() {
    restore();
    setEditing(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLSpanElement>) {
    if (!editing && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      begin();
      return;
    }
    if (editing && e.key === 'Enter') {
      e.preventDefault();
      ref.current?.blur();
    }
    if (editing && e.key === 'Escape') {
      cancel();
      ref.current?.blur();
    }
  }

  const className = uncertain
    ? 'editable'
    : [
        'etext',
        editing ? 'editing' : '',
        claim.status === 'settled' ? 'settled' : '',
      ].filter(Boolean).join(' ');

  return (
    <span
      // Remount when the committed text changes so contenteditable DOM
      // mutations never fight React's text-node reconciliation.
      key={`${claim.id}:${claim.text}`}
      ref={ref}
      className={className}
      role="button"
      tabIndex={0}
      aria-label={SLOT_LABELS[claim.slot]}
      contentEditable={editing}
      suppressContentEditableWarning
      onClick={begin}
      onKeyDown={onKeyDown}
      onBlur={commit}
    >
      {claim.text}
    </span>
  );
}
