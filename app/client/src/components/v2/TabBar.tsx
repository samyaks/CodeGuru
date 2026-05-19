import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

export type TabBadgeColor = 'default' | 'emerald' | 'red';

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
      {/* `overflow-x-auto` lets the 5-tab v2 workspace bar scroll
          horizontally below ~640px instead of clipping or forcing a
          page-level horizontal scroll. The negative margin / matching
          padding keeps the underline flush with the parent's edge so
          the affordance looks intentional rather than clipped, and
          `flex-nowrap` prevents wrapping into a stacked second row
          which would break the underline-as-active pattern. */}
      <div
        role="tablist"
        aria-orientation="horizontal"
        className="flex flex-nowrap gap-1 overflow-x-auto -mx-2 px-2 [scrollbar-width:thin]"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeId === tab.id;
          const showBadge = tab.badge !== null && tab.badge !== undefined && tab.badge > 0;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-2 px-4 sm:px-5 py-3 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap flex-shrink-0 ${
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
                        : tab.badgeColor === 'red'
                          ? 'bg-red-600 text-white'
                          : 'bg-stone-900 text-white'
                      : tab.badgeColor === 'red'
                        ? 'bg-red-50 text-red-700'
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
