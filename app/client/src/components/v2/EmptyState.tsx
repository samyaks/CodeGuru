import type { ComponentType, ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';

export interface EmptyStateProps {
  icon?: ComponentType<LucideProps>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`bg-white border border-stone-200 rounded-lg p-8 text-center ${className}`.trim()}
    >
      {Icon ? <Icon className="w-8 h-8 text-stone-400 mx-auto mb-3" /> : null}
      <p className="font-semibold text-stone-900 mb-1">{title}</p>
      {description ? (
        <p className="text-sm text-stone-600">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
