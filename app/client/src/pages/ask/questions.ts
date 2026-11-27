import type { AskView } from '../../services/askApi';

// Suggested first questions. A Creator (who decides what the product should
// do) and a Builder (who builds it with an AI agent) ask different things.
// Picking one fills the box; it is never asked for the person.

export const SUGGESTIONS: Record<AskView, string[]> = {
  creator: [
    'What has the team agreed so far, and what is still open?',
    'Which parts of the plan aren’t built yet?',
    'Which recent pull requests drifted from the plan, and what was decided?',
  ],
  builder: [
    'Which rules in the plan apply to the area I’m working on?',
    'Why was my last pull request sent back, and what should change?',
    'Where in the code is sign-in handled, and does it match the plan?',
  ],
};

/** Questions for "Ask about this" links, in the person's voice. */
export const aboutArea = (name: string) => `What does the plan say about ${name}, and how is it built today?`;
export const aboutPr = (n: number) => `What did PR #${n} change, and how does it compare with the plan?`;
export const aboutDecision = (sentence: string) => `Why was this decided, and what does it mean for the plan? ${sentence}`;
