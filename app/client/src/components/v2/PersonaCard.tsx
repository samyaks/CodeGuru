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
      className={`bg-white border border-stone-200 rounded-lg p-5 hover:border-stone-300 transition-colors ${className}`.trim()}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="text-2xl" aria-hidden>{persona.icon}</div>
          <div>
            <p className="font-semibold text-stone-900">{persona.name}</p>
            <p className="text-xs text-stone-500">{persona.jobs} jobs to be done</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-stone-900">
            {persona.readiness}
            <span className="text-sm text-stone-400">%</span>
          </p>
          <p className="text-xs text-stone-500">ready</p>
        </div>
      </div>
      <ProgressBar value={persona.readiness} label={`${persona.name} readiness`} />
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="mt-3 text-xs text-stone-600 hover:text-stone-900 font-medium flex items-center gap-1"
        >
          <Edit2 className="w-3 h-3" /> Edit jobs
        </button>
      ) : null}
    </div>
  );
}

export default PersonaCard;
