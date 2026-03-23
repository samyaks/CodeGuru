import React from 'react';
import { AlertTriangle, AlertCircle, Info, CheckCircle } from 'lucide-react';

interface Props {
  severity: string | null;
  size?: 'sm' | 'md';
}

const config: Record<string, { label: string; className: string; Icon: React.ElementType }> = {
  critical: { label: 'Critical', className: 'badge badge-critical', Icon: AlertCircle },
  warning: { label: 'Warning', className: 'badge badge-warning', Icon: AlertTriangle },
  info: { label: 'Info', className: 'badge badge-info', Icon: Info },
  ok: { label: 'OK', className: 'badge badge-ok', Icon: CheckCircle },
};

export default function SeverityBadge({ severity, size = 'md' }: Props) {
  const c = config[severity || 'ok'] || config.ok;
  const iconSize = size === 'sm' ? 12 : 14;
  return (
    <span className={`${c.className} ${size === 'sm' ? 'badge-sm' : ''}`}>
      <c.Icon size={iconSize} />
      {c.label}
    </span>
  );
}
