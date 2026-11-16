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
  status: Status;
  where?: string;
}

export interface ProjectStory {
  name: string;
  /** The verdict, in a sentence. */
  headline: string;
  /** One or two sentences under the verdict. */
  support: string;
  /** What the person told Takeoff, one line each, in their words. */
  told: string[];
  checks: LaunchCheck[];
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
