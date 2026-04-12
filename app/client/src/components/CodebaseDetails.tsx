import { useState } from 'react';
import {
  ChevronDown, ChevronRight, FolderTree, Layers, Code2,
  FileCode, Shield, Database, Rocket, TestTube2,
  AlertTriangle, Settings2,
} from 'lucide-react';
import type { AnalysisData, FeatureInfo, GapInfo } from '../services/api';

const GAP_META: Record<string, { icon: React.ReactNode; label: string }> = {
  auth: { icon: <Shield size={16} />, label: 'Authentication' },
  database: { icon: <Database size={16} />, label: 'Database' },
  deployment: { icon: <Rocket size={16} />, label: 'Deployment Config' },
  permissions: { icon: <Shield size={16} />, label: 'Permissions & Roles' },
  testing: { icon: <TestTube2 size={16} />, label: 'Testing' },
  errorHandling: { icon: <AlertTriangle size={16} />, label: 'Error Handling' },
  envConfig: { icon: <Settings2 size={16} />, label: 'Environment Config' },
};

function CollapsibleSection({
  icon, title, subtitle, defaultOpen = false, children,
}: {
  icon: React.ReactNode; title: string; subtitle: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl bg-navy border border-sky-border/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-sky-border/5 transition-colors"
      >
        {icon}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-sky-white">{title}</span>
          <span className="ml-2 text-xs text-sky-muted">{subtitle}</span>
        </div>
        {open ? <ChevronDown size={16} className="text-sky-muted" /> : <ChevronRight size={16} className="text-sky-muted" />}
      </button>
      {open && <div className="px-5 pb-5 pt-1">{children}</div>}
    </div>
  );
}

function FeatureRow({ feature }: { feature: FeatureInfo }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-midnight/50 border border-sky-border/30">
      <code className="text-xs text-sky-off font-medium truncate flex-1">{feature.name}</code>
      <div className="flex items-center gap-2 shrink-0">
        {feature.hasUI && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gold/10 text-gold border border-gold/20">UI</span>}
        {feature.hasAPI && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 border border-blue-500/20">API</span>}
        {feature.hasTests && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">Tests</span>}
        <span className="text-[10px] text-sky-muted">{feature.fileCount} files</span>
      </div>
    </div>
  );
}

function GapRow({ gapKey, gap }: { gapKey: string; gap: GapInfo }) {
  const meta = GAP_META[gapKey] || { icon: <Code2 size={16} />, label: gapKey };
  const details: string[] = [];

  if (gapKey === 'auth' && gap.provider) details.push(`Provider: ${gap.provider}`);
  if (gapKey === 'database' && gap.type) details.push(`Type: ${gap.type}`);
  if (gapKey === 'database' && gap.hasSchema) details.push('Has schema');
  if (gapKey === 'database' && gap.hasMigrations) details.push('Has migrations');
  if (gapKey === 'deployment' && gap.platform) details.push(`Platform: ${gap.platform}`);
  if (gapKey === 'deployment' && gap.hasCI) details.push('Has CI/CD');
  if (gapKey === 'testing' && gap.coverage) details.push(`Coverage: ${gap.coverage}`);
  if (gap.issues && gap.issues.length > 0) details.push(...gap.issues);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-midnight/50 border border-sky-border/30">
      <span className={gap.exists ? 'text-emerald-600' : 'text-red-600'}>{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-sky-white">{meta.label}</div>
        {details.length > 0 && (
          <div className="text-xs text-sky-muted mt-0.5">{details.join(' · ')}</div>
        )}
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
        gap.exists
          ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
          : 'bg-red-500/10 text-red-600 border border-red-500/20'
      }`}>
        {gap.exists ? 'Found' : 'Missing'}
      </span>
    </div>
  );
}

export default function CodebaseDetails({ analysis, gaps }: { analysis: AnalysisData; gaps: Record<string, GapInfo> }) {
  const fileTree = analysis.fileTree || [];
  const structure = analysis.structure || { directories: [], entryPoints: [], routeFiles: [], configFiles: [] };
  const features = analysis.features || [];
  const existingContext = analysis.existingContext || {};

  return (
    <div className="space-y-6">
      {fileTree.length > 0 && (
        <CollapsibleSection
          icon={<FolderTree size={18} className="text-gold" />}
          title="Project Structure"
          subtitle={`${fileTree.length} files · ${(structure.directories || []).length} directories`}
          defaultOpen
        >
          <div className="space-y-4">
            {(structure.entryPoints || []).length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-sky-muted uppercase tracking-wide mb-2">Entry Points</h4>
                <div className="flex flex-wrap gap-1.5">
                  {structure.entryPoints.map((f) => (
                    <code key={f} className="text-xs px-2 py-1 rounded bg-navy border border-sky-border/50 text-emerald-600">{f}</code>
                  ))}
                </div>
              </div>
            )}
            {(structure.routeFiles || []).length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-sky-muted uppercase tracking-wide mb-2">Routes / API</h4>
                <div className="flex flex-wrap gap-1.5">
                  {structure.routeFiles.map((f) => (
                    <code key={f} className="text-xs px-2 py-1 rounded bg-navy border border-sky-border/50 text-sky-off">{f}</code>
                  ))}
                </div>
              </div>
            )}
            {(structure.configFiles || []).length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-sky-muted uppercase tracking-wide mb-2">Config Files</h4>
                <div className="flex flex-wrap gap-1.5">
                  {structure.configFiles.map((f) => (
                    <code key={f} className="text-xs px-2 py-1 rounded bg-navy border border-sky-border/50 text-sky-muted">{f}</code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {features.length > 0 && (
        <CollapsibleSection
          icon={<Layers size={18} className="text-gold" />}
          title="Feature Modules"
          subtitle={`${features.length} modules detected`}
          defaultOpen
        >
          <div className="grid gap-2">
            {features
              .sort((a, b) => b.fileCount - a.fileCount)
              .slice(0, 20)
              .map((feat) => (
                <FeatureRow key={feat.path} feature={feat} />
              ))}
            {features.length > 20 && (
              <p className="text-xs text-sky-muted pt-1">...and {features.length - 20} more</p>
            )}
          </div>
        </CollapsibleSection>
      )}

      {Object.keys(gaps).length > 0 && (
        <CollapsibleSection
          icon={<Code2 size={18} className="text-amber-600" />}
          title="Infrastructure Gaps"
          subtitle={`${Object.values(gaps).filter((g) => g.exists).length} of ${Object.keys(gaps).length} areas covered`}
          defaultOpen
        >
          <div className="grid gap-2">
            {Object.entries(gaps).map(([key, gap]) => (
              <GapRow key={key} gapKey={key} gap={gap} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {fileTree.length > 0 && (
        <CollapsibleSection
          icon={<FileCode size={18} className="text-sky-muted" />}
          title="File Tree"
          subtitle={`${fileTree.length} files analyzed`}
        >
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {fileTree.map((f) => (
              <div key={f} className="text-xs text-sky-muted font-mono truncate">{f}</div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {(existingContext.hasCursorRules || existingContext.hasClaudeMd || existingContext.hasContextMd) && (
        <div className="flex flex-wrap gap-2 pt-2">
          {existingContext.hasCursorRules && (
            <span className="px-3 py-1 rounded-full text-xs bg-gold/10 border border-gold/20 text-gold">Has .cursorrules</span>
          )}
          {existingContext.hasClaudeMd && (
            <span className="px-3 py-1 rounded-full text-xs bg-gold/10 border border-gold/20 text-gold">Has CLAUDE.md</span>
          )}
          {existingContext.hasContextMd && (
            <span className="px-3 py-1 rounded-full text-xs bg-gold/10 border border-gold/20 text-gold">Has .context.md</span>
          )}
        </div>
      )}
    </div>
  );
}
