import type { Status } from '../../components/takeoff';

// Shapes the project page and the intake conversation read. They are written
// for the screens, not for the API: when the backend is plugged in, map its
// data into these, so the views do not change.

export interface LaunchCheck {
  id: string;
  /** Short name, used on buttons and lists ("Payments"). */
  label: string;
  /** What the app needs to do, in the person's words. */
  need: string;
  status: Status;
  /** What someone would notice in the app, in plain words. */
  explanation: string;
  /** A place in the app in the person's terms ("Checkout page"), never a file path. */
  where?: string;
  /** How many changes were checked against this. */
  changes?: number;
}

export interface ShippedChange {
  id: string;
  summary: string;
  /** Already formatted: "Yesterday", "3 days ago". */
  when: string;
  /** Left out when the change hasn't been checked against the person's needs. */
  status?: Status;
  where?: string;
}

/** The next feature to build, derived from the read. */
export interface BuildNext {
  title: string;
  why: string;
  /** null until the person signs in. */
  prompt: string | null;
  gated: boolean;
}

/** Something missing or broken, with the people and jobs it affects. */
export interface BuildGap {
  id: string;
  title: string;
  summary: string;
  kind: 'broken' | 'missing';
  /** Who it matters to: a persona and the job they are trying to get done. */
  jobs: { persona: string | null; job: string }[];
  /** null until fetched; the page asks for it when someone copies. */
  prompt: string | null;
}

/** A person the app is for, and the jobs they are trying to get done. */
export interface StoryPersona {
  id: string;
  name: string;
  description?: string;
  /** Not-done jobs first, most important first. */
  jobs: { id: string; title: string; done: boolean }[];
}

export interface BuildSection {
  next: BuildNext | null;
  gaps: BuildGap[];
}

export interface ProjectStory {
  name: string;
  /** The verdict, in a sentence. */
  headline: string;
  /** One or two sentences under the verdict. */
  support: string;
  /** What the person told Takeoff, one line each, in their words. */
  told: string[];
  /** Whether `told` is ready, still being drafted, or could not be loaded. Defaults to ready when there are lines. */
  toldStatus?: 'ready' | 'drafting' | 'failed';
  checks: LaunchCheck[];
  /** Who the app is for. Left out when there is no product map. */
  personas?: StoryPersona[];
  /** What to build after the checks. Left out when there is nothing to show. */
  build?: BuildSection;
  shipped: ShippedChange[];
  /** Already formatted: "2 hours ago". */
  readAt: string;
}

export interface IntakeChoice {
  id: string;
  label: string;
  /** What picking this means, shown under the answer. */
  meaning?: string;
  /** This choice means the check is not needed. */
  skips?: boolean;
  /** "Not sure". Used when someone skips the rest of the questions. */
  unsure?: boolean;
}

export interface IntakeFinding {
  label: string;
  status: Status;
  note: string;
}

export interface IntakeQuestion {
  id: string;
  /** Short name for the check this question switches on ("Payments"). */
  topic: string;
  /** Takeoff's question, in plain words. */
  ask: string;
  /** What Takeoff saw that made it ask. */
  because?: string;
  choices: IntakeChoice[];
  /** What Takeoff already found for this topic, shown once it is answered. */
  finding: IntakeFinding;
}

export interface IntakeScript {
  /** Takeoff's draft of what the person is building, for them to correct. */
  draft: string;
  /** Checks that need no question because the code answers them. */
  alreadyFound: IntakeFinding[];
  /** A few questions at most. */
  questions: IntakeQuestion[];
}
