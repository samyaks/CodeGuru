import type { ReactNode } from 'react';

export interface MetadataLabelProps {
  children: ReactNode;
  className?: string;
}

export function MetadataLabel({ children, className = '' }: MetadataLabelProps) {
  return (
    <p className={`text-xs uppercase tracking-widest text-stone-500 ${className}`.trim()}>
      {children}
    </p>
  );
}

export default MetadataLabel;
