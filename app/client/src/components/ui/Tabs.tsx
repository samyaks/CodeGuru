import { ReactNode } from 'react';

export interface TabItem<T extends string> {
  key: T;
  label: string;
  badge?: ReactNode;
  icon?: ReactNode;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
}

/**
 * Pill-style segmented tabs (white card, active = filled brand).
 * Used in Dashboard + ProjectView in the kit.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: TabsProps<T>) {
  return (
    <div
      className={[
        'inline-flex gap-1 bg-surface border border-line rounded-[10px] p-1 shadow-card',
        className,
      ].join(' ')}
    >
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={[
              'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[7px] text-[13px] font-medium transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
              active
                ? 'bg-brand text-white border border-brand'
                : 'border border-transparent text-text-muted hover:text-text',
            ].join(' ')}
          >
            {t.icon}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Underline tab bar (active = brand text + 2px underline).
 * Used in Product Map in the kit.
 */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: TabsProps<T>) {
  return (
    <div className={['flex gap-0.5', className].join(' ')}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={[
              'inline-flex items-center gap-1.5 px-3.5 py-3 text-[13px] font-medium transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
              'border-b-2',
              active
                ? 'text-brand border-brand'
                : 'text-text-muted border-transparent hover:text-text',
            ].join(' ')}
          >
            {t.icon}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}
