import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  CheckCircle2, XCircle, AlertCircle, Rocket, ClipboardList,
  ChevronDown, ChevronRight, FolderTree, Layers, Code2, GitFork,
  Star, Shield, Database, TestTube2, AlertTriangle, FileCode, Settings2,
  BookOpen, Copy, Check, Lightbulb,
} from 'lucide-react';
import Header from '../components/Header';
import {
  fetchProject,
  fetchSuggestions,
  type Project,
  type Suggestion,
  type SuggestionsSummary,
  type ReadinessCategory,
  type AnalysisData,
  type FeatureInfo,
  type GapInfo,
  type StackInfo,
  type BuildPlan,
} from '../services/api';
import { useAuth } from '../hooks/useAuth';

const STATUS_ICON: Record<string, React.ReactNode> = {
  ready: <CheckCircle2 size={18} className="text-success" />,
  partial: <AlertCircle size={18} className="text-warning" />,
  missing: <XCircle size={18} className="text-danger" />,
};

const GAP_META: Record<string, { icon: React.ReactNode; label: string }> = {
  auth: { icon: <Shield size={16} />, label: 'Authentication' },
  database: { icon: <Database size={16} />, label: 'Database' },
  deployment: { icon: <Rocket size={16} />, label: 'Deployment Config' },
  permissions: { icon: <Shield size={16} />, label: 'Permissions & Roles' },
  testing: { icon: <TestTube2 size={16} />, label: 'Testing' },
  errorHandling: { icon: <AlertTriangle size={16} />, label: 'Error Handling' },
  envConfig: { icon: <Settings2 size={16} />, label: 'Environment Config' },
};

export default function ReadinessReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'overview' | 'details' | 'suggestions'>('overview');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsSummary, setSuggestionsSummary] = useState<SuggestionsSummary | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const hasUserSwitchedTab = useRef(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchProject(id)
      .then(p => { if (!cancelled) setProject(p); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchSuggestions(id)
      .then(data => {
        if (cancelled) return;
        setSuggestions(data.suggestions);
        setSuggestionsSummary(data.summary);
      })
      .catch((err) => { if (!cancelled) setSuggestionsError(err.message); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!loading && project && (project.status === 'analyzing' || project.status === 'pending')) {
      navigate(`/takeoff/${id}`, { replace: true });
    }
    if (!loading && project?.features_summary && !hasUserSwitchedTab.current) {
      setActiveTab('summary');
    }
  }, [loading, project, id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo="/" />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-text-muted">Loading report...</div>
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo="/" />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-danger">{error || 'Project not found'}</div>
        </main>
      </div>
    );
  }

  if (project.status === 'analyzing' || project.status === 'pending') return null;

  const score = project.readiness_score ?? 0;
  const categories: Record<string, ReadinessCategory> = project.readiness_categories || {};
  const recommendation = project.recommendation || 'plan';
  const stack: Partial<StackInfo> = project.stack_info || {};
  const buildPlan: Partial<BuildPlan> = project.build_plan || {};
  const analysis = project.analysis_data;
  const isDeployRecommended = recommendation === 'deploy';

  const stackBadges = [
    stack.framework,
    stack.styling,
    stack.database,
    stack.auth,
    ...(stack.languages || []),
  ].filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo="/" title={`${project.owner}/${project.repo}`} />

      <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full space-y-10">
        {/* Score + description */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-28 h-28 rounded-full border-4 border-brand bg-surface">
            <span className="text-4xl font-bold text-text">{score}%</span>
          </div>
          <h1 className="text-2xl font-semibold text-text">Production Readiness</h1>
          {project.description && (
            <p className="text-text-soft text-sm max-w-lg mx-auto italic">{project.description}</p>
          )}
          <p className="text-text-muted text-sm max-w-md mx-auto">
            {score >= 90
              ? 'Your app looks ready to deploy. You can ship it now or review the details below.'
              : `Your app is ${score}% of the way there. We've identified what's missing and built you a plan.`}
          </p>
        </div>

        {/* Stack badges */}
        {stackBadges.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {stackBadges.map((badge) => (
              <span key={badge} className="px-3 py-1 rounded-full text-xs bg-surface border border-line text-text-soft">
                {badge}
              </span>
            ))}
            {buildPlan.type && (
              <span className="px-3 py-1 rounded-full text-xs bg-brand-tint border border-brand-tint-border text-brand">
                {buildPlan.type === 'static' ? 'Static site' : buildPlan.type === 'fullstack' ? 'Full-stack' : buildPlan.type}
              </span>
            )}
            {analysis?.meta && (
              <>
                {analysis.meta.stars > 0 && (
                  <span className="px-3 py-1 rounded-full text-xs bg-surface border border-line text-text-muted flex items-center gap-1">
                    <Star size={10} /> {analysis.meta.stars}
                  </span>
                )}
                {analysis.meta.forks > 0 && (
                  <span className="px-3 py-1 rounded-full text-xs bg-surface border border-line text-text-muted flex items-center gap-1">
                    <GitFork size={10} /> {analysis.meta.forks}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex items-center justify-center gap-2 text-sm">
          {project.features_summary && (
            <button
              onClick={() => { hasUserSwitchedTab.current = true; setActiveTab('summary'); }}
              className={`px-4 py-1.5 rounded-lg transition-colors ${activeTab === 'summary' ? 'bg-brand-tint-2 text-brand border border-brand' : 'text-text-muted hover:text-text'}`}
            >
              What It Does
            </button>
          )}
          <button
            onClick={() => { hasUserSwitchedTab.current = true; setActiveTab('overview'); }}
            className={`px-4 py-1.5 rounded-lg transition-colors ${activeTab === 'overview' ? 'bg-brand-tint-2 text-brand border border-brand' : 'text-text-muted hover:text-text'}`}
          >
            Readiness
          </button>
          <button
            onClick={() => { hasUserSwitchedTab.current = true; setActiveTab('details'); }}
            className={`px-4 py-1.5 rounded-lg transition-colors ${activeTab === 'details' ? 'bg-brand-tint-2 text-brand border border-brand' : 'text-text-muted hover:text-text'}`}
          >
            Codebase Details
          </button>
          <button
            onClick={() => { hasUserSwitchedTab.current = true; setActiveTab('suggestions'); }}
            className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${activeTab === 'suggestions' ? 'bg-brand-tint-2 text-brand border border-brand' : 'text-text-muted hover:text-text'}`}
          >
            <Lightbulb size={14} />
            Suggestions
            {suggestionsSummary && suggestionsSummary.total > 0 && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-brand-tint text-brand border border-brand-tint-border">
                {suggestionsSummary.total}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'summary' && project.features_summary ? (
          <FeaturesSummary summary={project.features_summary} />
        ) : activeTab === 'suggestions' ? (
          suggestionsError ? (
            <div className="text-center py-12 text-danger text-sm">Failed to load suggestions: {suggestionsError}</div>
          ) : (
            <SuggestionsPreview suggestions={suggestions} summary={suggestionsSummary} projectId={id ?? ''} />
          )
        ) : activeTab === 'overview' ? (
          <>
            {/* Category breakdown */}
            <div className="grid gap-2">
              {Object.entries(categories).map(([key, cat]) => (
                <div key={key} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface border border-line">
                  {STATUS_ICON[cat.status]}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text">{cat.label}</div>
                    <div className="text-xs text-text-muted truncate">{cat.detail}</div>
                  </div>
                  <div className="text-xs text-text-muted">{cat.earned}/{cat.weight}</div>
                </div>
              ))}
            </div>

            {/* Dual-path choice */}
            <div className="grid md:grid-cols-2 gap-4">
              <button
                onClick={() => {
                  if (!user) { alert('Please log in to deploy.'); return; }
                  navigate(`/takeoff/${id}/env-setup`);
                }}
                className={`p-6 rounded-xl border text-left transition-all ${
                  isDeployRecommended
                    ? 'bg-brand-tint border-brand hover:bg-brand-tint-2 ring-1 ring-brand-tint-border'
                    : 'bg-surface border-line hover:bg-page'
                }`}
              >
                <Rocket size={24} className={isDeployRecommended ? 'text-brand mb-3' : 'text-text-muted mb-3'} />
                <h3 className="font-semibold text-text mb-1">
                  {isDeployRecommended ? 'Deploy Now' : 'Deploy Anyway'}
                </h3>
                <p className="text-xs text-text-muted">
                  {isDeployRecommended
                    ? 'Your app looks ready. Ship it to the world.'
                    : 'Ship as-is. You can improve later.'}
                </p>
                {isDeployRecommended && (
                  <span className="inline-block mt-3 text-xs text-brand font-medium">Recommended</span>
                )}
              </button>

              <Link
                to={`/takeoff/${id}/plan`}
                className={`p-6 rounded-xl border text-left transition-all block ${
                  !isDeployRecommended
                    ? 'bg-brand-tint border-brand hover:bg-brand-tint-2 ring-1 ring-brand-tint-border'
                    : 'bg-surface border-line hover:bg-page'
                }`}
              >
                <ClipboardList size={24} className={!isDeployRecommended ? 'text-brand mb-3' : 'text-text-muted mb-3'} />
                <h3 className="font-semibold text-text mb-1">
                  {!isDeployRecommended ? 'Plan to Ship' : 'See Plan Anyway'}
                </h3>
                <p className="text-xs text-text-muted">
                  {!isDeployRecommended
                    ? `${Object.values(categories).filter((c) => c.status === 'missing').length} things to add. Context files + prompts for each step.`
                    : 'Review what could be improved with context files for each area.'}
                </p>
                {!isDeployRecommended && (
                  <span className="inline-block mt-3 text-xs text-brand font-medium">Recommended</span>
                )}
              </Link>
            </div>
          </>
        ) : analysis ? (
          <CodebaseDetails analysis={analysis} gaps={analysis.gaps} />
        ) : (
          <div className="text-center py-12 text-text-muted text-sm">
            Detailed analysis data is not available for this project. Try re-analyzing.
          </div>
        )}
      </main>
    </div>
  );
}

function CodebaseDetails({ analysis, gaps }: { analysis: AnalysisData; gaps: Record<string, GapInfo> }) {
  return (
    <div className="space-y-6">
      {/* Project structure */}
      <CollapsibleSection
        icon={<FolderTree size={18} className="text-brand" />}
        title="Project Structure"
        subtitle={`${analysis.fileTree.length} files · ${analysis.structure.directories.length} directories`}
        defaultOpen
      >
        <div className="space-y-4">
          {analysis.structure.entryPoints.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Entry Points</h4>
              <div className="flex flex-wrap gap-1.5">
                {analysis.structure.entryPoints.map((f) => (
                  <code key={f} className="text-xs px-2 py-1 rounded bg-surface border border-line text-success">{f}</code>
                ))}
              </div>
            </div>
          )}
          {analysis.structure.routeFiles.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Routes / API</h4>
              <div className="flex flex-wrap gap-1.5">
                {analysis.structure.routeFiles.map((f) => (
                  <code key={f} className="text-xs px-2 py-1 rounded bg-surface border border-line text-text-soft">{f}</code>
                ))}
              </div>
            </div>
          )}
          {analysis.structure.configFiles.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Config Files</h4>
              <div className="flex flex-wrap gap-1.5">
                {analysis.structure.configFiles.map((f) => (
                  <code key={f} className="text-xs px-2 py-1 rounded bg-surface border border-line text-text-muted">{f}</code>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Feature modules */}
      {analysis.features.length > 0 && (
        <CollapsibleSection
          icon={<Layers size={18} className="text-brand" />}
          title="Feature Modules"
          subtitle={`${analysis.features.length} modules detected`}
          defaultOpen
        >
          <div className="grid gap-2">
            {analysis.features
              .sort((a, b) => b.fileCount - a.fileCount)
              .slice(0, 20)
              .map((feat) => (
                <FeatureRow key={feat.path} feature={feat} />
              ))}
            {analysis.features.length > 20 && (
              <p className="text-xs text-text-muted pt-1">...and {analysis.features.length - 20} more</p>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Gap detail */}
      <CollapsibleSection
        icon={<Code2 size={18} className="text-warning" />}
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

      {/* File tree */}
      <CollapsibleSection
        icon={<FileCode size={18} className="text-text-muted" />}
        title="File Tree"
        subtitle={`${analysis.fileTree.length} files analyzed`}
      >
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {analysis.fileTree.map((f) => (
            <div key={f} className="text-xs text-text-muted font-mono truncate">{f}</div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Existing context */}
      {(analysis.existingContext.hasCursorRules || analysis.existingContext.hasClaudeMd || analysis.existingContext.hasContextMd) && (
        <div className="flex flex-wrap gap-2 pt-2">
          {analysis.existingContext.hasCursorRules && (
            <span className="px-3 py-1 rounded-full text-xs bg-brand-tint border border-brand-tint-border text-brand">Has .cursorrules</span>
          )}
          {analysis.existingContext.hasClaudeMd && (
            <span className="px-3 py-1 rounded-full text-xs bg-brand-tint border border-brand-tint-border text-brand">Has CLAUDE.md</span>
          )}
          {analysis.existingContext.hasContextMd && (
            <span className="px-3 py-1 rounded-full text-xs bg-brand-tint border border-brand-tint-border text-brand">Has .context.md</span>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  icon, title, subtitle, defaultOpen = false, children,
}: {
  icon: React.ReactNode; title: string; subtitle: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl bg-surface border border-line overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-page transition-colors"
      >
        {icon}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-text">{title}</span>
          <span className="ml-2 text-xs text-text-muted">{subtitle}</span>
        </div>
        {open ? <ChevronDown size={16} className="text-text-muted" /> : <ChevronRight size={16} className="text-text-muted" />}
      </button>
      {open && <div className="px-5 pb-5 pt-1">{children}</div>}
    </div>
  );
}

function FeatureRow({ feature }: { feature: FeatureInfo }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-page border border-divider">
      <code className="text-xs text-text-soft font-medium truncate flex-1">{feature.name}</code>
      <div className="flex items-center gap-2 shrink-0">
        {feature.hasUI && <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-tint text-brand border border-brand-tint-border">UI</span>}
        {feature.hasAPI && <span className="text-[10px] px-1.5 py-0.5 rounded bg-info-bg text-info border border-info-border">API</span>}
        {feature.hasTests && <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-bg text-success border border-success-border">Tests</span>}
        <span className="text-[10px] text-text-muted">{feature.fileCount} files</span>
      </div>
    </div>
  );
}

function FeaturesSummary({ summary }: { summary: string }) {
  const [copied, setCopied] = useState(false);
  const sections = parseSummaryIntoSections(summary);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-brand-tint-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-brand-tint-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-brand-tint">
            <BookOpen size={20} className="text-brand" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text">What this project does</h2>
            <p className="text-xs text-text-muted">Plain-English explanation — no technical jargon</p>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-tint hover:bg-brand-tint-2 text-brand border border-brand-tint-border transition-colors"
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="px-5 py-5 space-y-5">
        {sections.map((section, i) => (
          <SummarySection key={i} title={section.title} content={section.content} defaultOpen={i < 3} />
        ))}
      </div>
    </div>
  );
}

function SummarySection({ title, content, defaultOpen }: { title: string; content: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left group">
        {open
          ? <ChevronDown size={16} className="text-brand shrink-0" />
          : <ChevronRight size={16} className="text-text-muted group-hover:text-brand shrink-0" />}
        <h3 className="text-sm font-semibold text-brand group-hover:text-brand-hov transition-colors">{title}</h3>
      </button>
      {open && (
        <div className="mt-2 ml-6 text-sm text-text-soft leading-relaxed whitespace-pre-wrap">{content}</div>
      )}
    </div>
  );
}

function parseSummaryIntoSections(text: string): { title: string; content: string }[] {
  const lines = text.split('\n');
  const sections: { title: string; content: string }[] = [];
  let currentTitle = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentTitle) {
        sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
      }
      currentTitle = headingMatch[1];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentTitle) {
    sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
  }
  if (sections.length === 0) {
    sections.push({ title: 'Summary', content: text.trim() });
  }
  return sections;
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
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-page border border-divider">
      <span className={gap.exists ? 'text-success' : 'text-danger'}>{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text">{meta.label}</div>
        {details.length > 0 && (
          <div className="text-xs text-text-muted mt-0.5">{details.join(' · ')}</div>
        )}
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
        gap.exists
          ? 'bg-success-bg text-success border border-success-border'
          : 'bg-danger-bg text-danger border border-danger-border'
      }`}>
        {gap.exists ? 'Found' : 'Missing'}
      </span>
    </div>
  );
}

function SuggestionsPreview({ suggestions, summary, projectId }: { suggestions: Suggestion[]; summary: SuggestionsSummary | null; projectId: string }) {
  const openSuggestions = suggestions.filter(s => s.status === 'open');
  const criticalCount = openSuggestions.filter(s => s.priority === 'critical').length;
  const highCount = openSuggestions.filter(s => s.priority === 'high').length;

  if (openSuggestions.length === 0) {
    return (
      <div className="text-center py-12 space-y-3">
        <Lightbulb size={32} className="text-text-muted mx-auto" />
        <p className="text-sm text-text-muted">No suggestions found for this project.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quick stats */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-text font-medium">{openSuggestions.length} suggestions</span>
        {criticalCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium border bg-danger-bg text-danger border-danger-border">
            {criticalCount} critical
          </span>
        )}
        {highCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium border bg-warning-bg text-warning border-warning-border">
            {highCount} high
          </span>
        )}
      </div>

      {/* Top 5 suggestions preview */}
      <div className="grid gap-2">
        {openSuggestions.slice(0, 5).map(s => (
          <div key={s.id} className="flex items-start gap-3 px-4 py-3 rounded-lg bg-surface border border-line">
            <span className={`mt-0.5 text-xs font-medium px-1.5 py-0.5 rounded border ${
              s.priority === 'critical' ? 'bg-danger-bg text-danger border-danger-border' :
              s.priority === 'high' ? 'bg-warning-bg text-warning border-warning-border' :
              s.priority === 'medium' ? 'bg-brand-tint text-brand border-brand-tint-border' :
              'bg-surface-2 text-text-muted border-line'
            }`}>
              {s.priority}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text">{s.title}</div>
              <div className="text-xs text-text-muted mt-0.5 truncate">{s.description}</div>
            </div>
          </div>
        ))}
      </div>

      {/* View all link */}
      {openSuggestions.length > 5 && (
        <p className="text-xs text-text-muted">Showing top 5 of {openSuggestions.length}</p>
      )}

      <Link
        to={`/takeoff/${projectId}/suggestions`}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hov transition-colors"
      >
        View All Suggestions →
      </Link>
    </div>
  );
}
