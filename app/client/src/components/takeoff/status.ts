export type Status = 'cleared' | 'holding' | 'grounded';

export const STATUSES: Status[] = ['cleared', 'holding', 'grounded'];

// The three status words and their first-use hints. Never show a status any
// other way.
export const STATUS: Record<Status, { word: string; hint: string }> = {
  cleared: { word: 'Cleared', hint: 'Matches your plan' },
  holding: { word: 'Holding', hint: 'Partly matches. Take a look' },
  grounded: { word: 'Grounded', hint: "Doesn't match your plan" },
};

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
