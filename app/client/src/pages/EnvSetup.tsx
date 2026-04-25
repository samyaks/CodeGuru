import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Loader2,
  KeyRound,
  ExternalLink,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  SkipForward,
} from 'lucide-react';
import Header from '../components/Header';
import {
  fetchProject,
  saveEnvVars,
  getEnvVars,
  type Project,
  type EnvVarDef,
} from '../services/api';
import { Button } from '../components/ui';

interface EnvGroup {
  label: string;
  vars: EnvVarDef[];
  helpUrl?: string;
  helpLabel?: string;
}

const GROUP_CONFIG: Record<string, { label: string; helpUrl: string; helpLabel: string }> = {
  SUPABASE: {
    label: 'Supabase',
    helpUrl: 'https://supabase.com/dashboard/project/_/settings/api',
    helpLabel: 'Supabase Dashboard',
  },
  DATABASE: {
    label: 'Database',
    helpUrl: 'https://supabase.com/dashboard/project/_/settings/database',
    helpLabel: 'Database Settings',
  },
  STRIPE: {
    label: 'Stripe',
    helpUrl: 'https://dashboard.stripe.com/apikeys',
    helpLabel: 'Stripe Dashboard',
  },
  NEXT_PUBLIC: {
    label: 'Next.js Public',
    helpUrl:
      'https://nextjs.org/docs/app/building-your-application/configuring/environment-variables',
    helpLabel: 'Next.js Env Docs',
  },
};

function groupEnvVars(vars: EnvVarDef[]): EnvGroup[] {
  const groups: Record<string, EnvVarDef[]> = {};
  const other: EnvVarDef[] = [];

  for (const v of vars) {
    let matched = false;
    for (const prefix of Object.keys(GROUP_CONFIG)) {
      if (v.name.startsWith(prefix + '_')) {
        if (!groups[prefix]) groups[prefix] = [];
        groups[prefix].push(v);
        matched = true;
        break;
      }
    }
    if (!matched) other.push(v);
  }

  const result: EnvGroup[] = [];
  for (const [prefix, items] of Object.entries(groups)) {
    const cfg = GROUP_CONFIG[prefix];
    result.push({ label: cfg.label, vars: items, helpUrl: cfg.helpUrl, helpLabel: cfg.helpLabel });
  }
  if (other.length > 0) {
    result.push({ label: 'Other', vars: other });
  }
  return result;
}

export default function EnvSetup() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const [proj, rawVars] = await Promise.all([
          fetchProject(id),
          getEnvVars(id).catch(() => ({}) as Record<string, string>),
        ]);
        if (cancelled) return;
        setProject(proj);
        const savedVars: Record<string, string> = rawVars;

        const envDefs: EnvVarDef[] = proj.build_plan?.envVarsRequired || [];
        const initial: Record<string, string> = {};
        for (const v of envDefs) {
          initial[v.name] = savedVars[v.name] ?? (v.hasDefault && v.value ? v.value : '');
        }
        setValues(initial);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const envDefs: EnvVarDef[] = useMemo(
    () => project?.build_plan?.envVarsRequired || [],
    [project],
  );

  const groups = useMemo(() => groupEnvVars(envDefs), [envDefs]);

  const handleChange = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveAndDeploy = async () => {
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    try {
      const filtered: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v.trim()) filtered[k] = v.trim();
      }
      await saveEnvVars(id, filtered);
      navigate(`/deploy/${id}`);
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-page">
        <Header backTo={id ? `/projects/${id}` : '/'} />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-text-faint animate-spin" />
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen flex flex-col bg-page">
        <Header backTo="/" />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="text-center space-y-4">
            <AlertCircle size={40} className="text-danger mx-auto" />
            <p className="text-danger">{error || 'Project not found'}</p>
            <Link
              to="/"
              className="text-sm text-brand hover:text-brand-hov transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const filledCount = Object.values(values).filter((v) => v.trim()).length;
  const totalCount = envDefs.length;
  const pct = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col bg-page">
      <Header backTo={`/projects/${id}`} title={`${project.owner}/${project.repo}`} />

      <main className="flex-1 px-6 py-10 max-w-[640px] mx-auto w-full flex flex-col gap-6">
        {/* Hero */}
        <div className="text-center flex flex-col items-center gap-3">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center shrink-0"
            style={{ background: '#fefce8', border: '2px solid #fde68a' }}
          >
            <KeyRound size={28} style={{ color: '#b45309' }} />
          </div>
          <h1 className="text-[22px] font-bold text-text -tracking-[0.03em]">
            Environment Variables
          </h1>
          <p className="text-sm text-text-muted max-w-[420px] leading-relaxed">
            {totalCount > 0
              ? `We found ${totalCount} environment variable${
                  totalCount !== 1 ? 's' : ''
                } your app needs. Fill them in so your deploy works on the first try.`
              : 'No environment variables were detected. You can deploy without them or add your own.'}
          </p>
        </div>

        {/* Progress */}
        {totalCount > 0 && (
          <div className="text-center">
            <span className="text-xs text-text-faint">
              {filledCount} of {totalCount} filled
            </span>
            <div
              className="mt-1.5 h-1 bg-surface-2 rounded-full overflow-hidden max-w-[280px] mx-auto"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-amber transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Groups */}
        {groups.map((group) => (
          <EnvGroupSection
            key={group.label}
            group={group}
            values={values}
            onChange={handleChange}
          />
        ))}

        {saveError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-bg border border-danger-border text-danger text-sm">
            <AlertCircle size={16} className="shrink-0" />
            {saveError}
          </div>
        )}

        {/* CTAs */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <Button
            onClick={handleSaveAndDeploy}
            disabled={saving}
            className="w-full max-w-[320px] !justify-center"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save & Deploy'
            )}
          </Button>

          <Link
            to={`/deploy/${id}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded px-2 py-1"
          >
            <SkipForward size={14} />
            Skip &mdash; deploy without env vars
          </Link>
        </div>
      </main>
    </div>
  );
}

function EnvGroupSection({
  group,
  values,
  onChange,
}: {
  group: EnvGroup;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-[14px] bg-surface border border-line overflow-hidden shadow-card">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-[18px] py-3.5 text-left hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {open ? (
          <ChevronDown size={16} className="text-text-faint shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-text-faint shrink-0" />
        )}
        <span className="text-sm font-semibold text-text flex-1">{group.label}</span>
        <span className="text-[11px] text-text-faint">
          {group.vars.length} var{group.vars.length !== 1 ? 's' : ''}
        </span>
      </button>
      {open && (
        <div className="px-[18px] pb-[18px] flex flex-col gap-3.5">
          {group.helpUrl && (
            <a
              href={group.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hov transition-colors self-start"
            >
              <ExternalLink size={12} />
              {group.helpLabel || 'Get values'}
            </a>
          )}
          {group.vars.map((v) => (
            <EnvVarInput
              key={v.name}
              def={v}
              value={values[v.name] || ''}
              onChange={(val) => onChange(v.name, val)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EnvVarInput({
  def,
  value,
  onChange,
}: {
  def: EnvVarDef;
  value: string;
  onChange: (val: string) => void;
}) {
  const isExample = def.hasDefault && def.value && value === def.value;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2">
        <code className="text-xs font-mono text-text-soft">{def.name}</code>
        {!def.hasDefault && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger-bg text-danger border border-danger-border font-medium">
            required
          </span>
        )}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={def.hasDefault && def.value ? def.value : `Enter ${def.name}`}
        className="w-full px-3 py-2 rounded-lg bg-page border border-line text-text text-[13px] font-mono placeholder:text-text-disabled focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/8 transition-colors"
      />
      {isExample && (
        <p className="text-[11px] text-amber-fg">
          Example value &mdash; replace with your real value
        </p>
      )}
    </div>
  );
}
