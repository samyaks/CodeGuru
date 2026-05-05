import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

export type TabBadgeColor = 'default' | 'emerald';

export interface TabDescriptor {
  id: string;
  label: string;
  icon?: ComponentType<LucideProps>;
  badge?: number | null;
  badgeColor?: TabBadgeColor;
}

export interface TabBarProps {
  tabs: TabDescriptor[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

export function TabBar({ tabs, activeId, onChange, className = '' }: TabBarProps) {
  return (
    <div className={`border-b border-stone-200 ${className}`.trim()}>
      <div className="flex gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeId === tab.id;
          const showBadge = tab.badge !== null && tab.badge !== undefined && tab.badge > 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all -mb-px ${
                isActive
                  ? 'border-stone-900 text-stone-900'
                  : 'border-transparent text-stone-500 hover:text-stone-900'
              }`}
            >
              {Icon ? <Icon className="w-4 h-4" /> : null}
              {tab.label}
              {showBadge ? (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    isActive
                      ? tab.badgeColor === 'emerald'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-stone-900 text-white'
                      : 'bg-stone-100 text-stone-600'
                  }`}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default TabBar;
