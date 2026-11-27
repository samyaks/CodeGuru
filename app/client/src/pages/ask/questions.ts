import type { AskView } from '../../services/askApi';
import type { LogEntry } from '../../services/overviewApi';

// Suggested first questions. A Creator (who decides what the product should
// do) and a Builder (who builds it with an AI agent) ask different things.
// Picking one fills the box; it is never asked for the person.

export const SUGGESTIONS: Record<AskView, string[]> = {
  creator: [
    'What has the team agreed so far, and what is still open?',
    'Which parts of the plan aren’t built yet?',
    'Which recent changes drifted from the plan, and what was decided?',
  ],
  builder: [
    'Which rules in the plan apply to the area I’m working on?',
    'Why was my last change sent back, and what should I do differently?',
    'Where in the code is sign-in handled, and does it match the plan?',
  ],
};

/** Questions for "Ask about this" links, in the person's voice. They name the
 * thing by its name or number, not by text other people wrote, so a note in
 * a decision can't become part of the person's own question. */
export const aboutArea = (name: string) => `What does the plan say about the ${short(name, 80)} area, and how is it built today?`;
export const aboutPr = (n: number) => `What did change #${n} do, and how does it compare with the plan?`;
export function aboutDecision(e: LogEntry): string {
  if (e.kind === 'agreement') return `Why did the team decide on the agreement that starts “${short(e.text, 80)}”, and what does it mean for the plan?`;
  return `Why was the decision on change #${e.prNumber} made, and what does it mean for the plan?`;
}

function short(text: string, max: number) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
