// Takeoff design system. Rules: app/client/CLAUDE.md. Every component expects
// to sit inside an element with className="takeoff" (styles/tokens.css).

export type { Status } from './status';
export { STATUS, STATUSES } from './status';

export { Button } from './Button';
export type { ButtonProps, ButtonVariant } from './Button';

export { ButtonLink } from './ButtonLink';
export type { ButtonLinkProps } from './ButtonLink';

export { StatusMark } from './StatusMark';
export type { StatusMarkProps } from './StatusMark';

export { StatusIcon } from './StatusIcon';
export type { StatusIconProps } from './StatusIcon';

export { IntentCard } from './IntentCard';
export type { IntentCardProps } from './IntentCard';

export { ConformanceRing } from './ConformanceRing';
export type { ConformanceRingProps } from './ConformanceRing';

export { ChangeNote } from './ChangeNote';
export type { ChangeNoteProps } from './ChangeNote';

export { VerdictPanel } from './VerdictPanel';
export type { VerdictPanelProps } from './VerdictPanel';

export { PlanInput } from './PlanInput';
export type { PlanInputProps } from './PlanInput';

export { Roadmap } from './Roadmap';
export type { RoadmapProps, RoadmapStage, RoadmapStageKind, RoadmapItem } from './Roadmap';

export { SocialCard, SOCIAL_FORMATS } from './SocialCard';
export type { SocialCardProps, SocialFormat, SocialKind, SocialTone } from './SocialCard';
