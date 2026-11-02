import { Edit2 } from 'lucide-react';
import { ProgressBar } from './ProgressBar';

export interface PersonaCardData {
  name: string;
  icon: string;
  readiness: number;
  jobs: number;
}

export interface PersonaCardProps {
  persona: PersonaCardData;
  onEdit?: () => void;
  className?: string;
}

export function PersonaCard({ persona, onEdit, className = '' }: PersonaCardProps) {
  return (
    <div
      className={`bg-paper-raised border border-line rounded-lg p-5 hover:border-line-strong transition-colors ${className}`.trim()}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="text-2xl" aria-hidden>{persona.icon}</div>
          <div>
            <p className="font-semibold text-ink">{persona.name}</p>
            <p className="text-xs text-ink-muted">{persona.jobs} jobs to be done</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-ink">
            {persona.readiness}
            <span className="text-sm text-ink-muted">%</span>
          </p>
          <p className="text-xs text-ink-muted">ready</p>
        </div>
      </div>
      <ProgressBar value={persona.readiness} label={`${persona.name} readiness`} />
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="mt-3 text-xs text-ink-muted hover:text-ink font-medium flex items-center gap-1"
        >
          <Edit2 className="w-3 h-3" /> Edit jobs
        </button>
      ) : null}
    </div>
  );
}

export default PersonaCard;
