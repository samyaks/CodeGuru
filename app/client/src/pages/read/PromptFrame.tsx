import { useRef, useState } from 'react';
import type { ReadNext } from '../../services/readApi';

// The real prompt is never sent while gated, so the blurred body is a
// plausible stand-in — fake mono lines, same as blurring the frame body.
const PLACEHOLDER_PROMPT =
  'Add the missing piece to your app, using the existing client in lib/db.ts.\n' +
  '1. Wire the first route behind a session and keep the current shape.\n' +
  '2. Add the one column that makes rows belong to a person.\n' +
  '3. Turn on the rule so each person reads only their own rows.';

interface PromptFrameProps {
  next: ReadNext;
  faded: boolean;
  unlocking: boolean;
  onUnlock: () => void;
}

/** The gated/unlocked "instructions to hand your builder" frame. */
export default function PromptFrame({ next, faded, unlocking, onUnlock }: PromptFrameProps) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copyPrompt() {
    if (!next.prompt) return;
    try {
      await navigator.clipboard.writeText(next.prompt);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — the text is visible to select by hand */
    }
  }

  return (
    <div className="prompt-frame">
      <div className="pf-head">
        <span className="t">The instructions to hand your builder</span>
        {next.gated ? (
          <span className="tag">🔒 Pro</span>
        ) : (
          <span className="tag unlocked">✓ Unlocked</span>
        )}
      </div>
      <div className={next.gated ? 'pf-body gated' : 'pf-body'}>
        <pre
          className={next.gated ? 'prompt gated' : 'prompt'}
          style={{ opacity: faded ? 0 : 1 }}
          aria-hidden={next.gated || undefined}
        >
          {next.gated ? PLACEHOLDER_PROMPT : (next.prompt ?? '')}
        </pre>
        <div className="gate">
          <div className="g1">Free tells you <em>what</em> to build.</div>
          <div className="g2">Pro hands you the exact words for your builder, written for your stack.</div>
        </div>
      </div>
      <div className="pf-foot">
        {next.gated ? (
          <button type="button" className="link" disabled={unlocking} onClick={onUnlock}>
            {unlocking ? 'Unlocking…' : 'Unlock with Pro'}
          </button>
        ) : (
          <button type="button" className="link quiet" onClick={() => void copyPrompt()}>
            {copied ? 'Copied ✓' : 'Copy it'}
          </button>
        )}
      </div>
    </div>
  );
}
