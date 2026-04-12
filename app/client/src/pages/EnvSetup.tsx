import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, KeyRound, ExternalLink, AlertCircle, ChevronDown, ChevronRight, SkipForward } from 'lucide-react';
import Header from '../components/Header';
import { fetchProject, saveEnvVars, getEnvVars, type Project, type EnvVarDef } from '../services/api';

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
    helpUrl: 'https://nextjs.org/docs/app/building-your-application/configuring/environment-variables',
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

    return () => { cancelled = true; };
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
      <div className="min-h-screen flex flex-col">
        <Header backTo={id ? `/projects/${id}` : '/'} />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-gold animate-spin" />
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo="/" />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="text-center space-y-4">
            <AlertCircle size={40} className="text-red-600 mx-auto" />
            <p className="text-red-600">{error || 'Project not found'}</p>
            <Link to="/" className="text-sm text-gold hover:underline">Back to Home</Link>
          </div>
        </main>
      </div>
    );
  }

  const filledCount = Object.values(values).filter((v) => v.trim()).length;
  const totalCount = envDefs.length;

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo={`/projects/${id}`} title={`${project.owner}/${project.repo}`} />

      <main className="flex-1 px-6 py-10 max-w-2xl mx-auto w-full space-y-8">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-full bg-gold/10 border-2 border-gold/20 flex items-center justify-center">
            <KeyRound size={28} className="text-gold" />
          </div>
          <h1 className="text-2xl font-bold text-sky-white">Environment Variables</h1>
          <p className="text-sky-muted text-sm max-w-md mx-auto">
            {totalCount > 0
              ? `We found ${totalCount} environment variable${totalCount !== 1 ? 's' : ''} your app needs. Fill them in so your deploy works on the first try.`
              : 'No environment variables were detected. You can deploy without them or add your own.'}
          </p>
        </div>

        {totalCount > 0 && (
          <div className="text-center">
            <span className="text-xs text-sky-muted">
              {filledCount} of {totalCount} filled
            </span>
            <div className="mt-1.5 h-1 bg-navy-mid rounded-full overflow-hidden max-w-xs mx-auto">
              <div
                className="h-full bg-gold rounded-full transition-all duration-300"
                style={{ width: `${totalCount > 0 ? (filledCount / totalCount) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {groups.map((group) => (
          <EnvGroupSection
            key={group.label}
            group={group}
            values={values}
            onChange={handleChange}
          />
        ))}

        {saveError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            {saveError}
          </div>
        )}

        <div className="flex flex-col items-center gap-4 pt-4">
          <button
            onClick={handleSaveAndDeploy}
            disabled={saving}
            className="w-full max-w-sm px-6 py-3 rounded-xl bg-gold text-midnight font-semibold text-sm hover:bg-gold-dim transition-colors btn-glow disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save & Deploy'
            )}
          </button>

          <Link
            to={`/deploy/${id}`}
            className="flex items-center gap-1.5 text-sm text-sky-muted hover:text-sky-white transition-colors"
          >
            <SkipForward size={14} />
            Skip — deploy without env vars
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
    <div className="rounded-xl bg-navy border border-sky-border/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-sky-border/5 transition-colors"
      >
        {open ? <ChevronDown size={16} className="text-sky-muted" /> : <ChevronRight size={16} className="text-sky-muted" />}
        <span className="text-sm font-medium text-sky-white flex-1">{group.label}</span>
        <span className="text-xs text-sky-muted">{group.vars.length} var{group.vars.length !== 1 ? 's' : ''}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4">
          {group.helpUrl && (
            <a
              href={group.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-gold hover:text-gold-dim transition-colors"
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
    <div className="space-y-1.5">
      <label className="flex items-center gap-2">
        <code className="text-xs font-mono text-sky-off">{def.name}</code>
        {!def.hasDefault && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">required</span>
        )}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={def.hasDefault && def.value ? def.value : `Enter ${def.name}`}
        className="w-full px-3 py-2 rounded-lg bg-midnight border border-sky-border/50 text-sky-white text-sm font-mono placeholder:text-sky-muted/50 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/20 transition-colors"
      />
      {isExample && (
        <p className="text-[11px] text-amber-500/80">
          Example value — replace with your real value
        </p>
      )}
    </div>
  );
}
