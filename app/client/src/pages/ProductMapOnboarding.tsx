import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { createProductMap, extractProductIntent, type ProductIntentExtraction } from '../services/productMapApi';
import { fetchProjectDetail } from '../services/api';
import { ApiError } from '../lib/api-error';

const STEP_LABELS = [
  'Describe your app',
  'Who uses it?',
  'What do they need to do?',
  'Map to your code',
  'Your roadmap',
];

type Persona = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  confirmed: boolean;
};

type JobItem = {
  id: string;
  personaId: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  confirmed: boolean;
};

const font = { fontFamily: "'DM Sans', ui-sans-serif, sans-serif" };
const mono = { fontFamily: "'DM Mono', ui-monospace, monospace" };

function Btn({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  small = false,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'success';
  disabled?: boolean;
  small?: boolean;
  type?: 'button' | 'submit';
}) {
  const styles = {
    primary: { bg: '#f43f5e', color: '#0f172a', border: 'none' },
    secondary: { bg: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1' },
    ghost: { bg: 'transparent', color: '#64748b', border: '1px solid #e2e8f0' },
    success: { bg: 'rgba(34,197,94,0.12)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.12)' },
  };
  const s = styles[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-lg font-semibold transition disabled:cursor-default"
      style={{
        ...font,
        background: disabled ? '#f8fafc' : s.bg,
        color: disabled ? '#cbd5e1' : s.color,
        border: s.border,
        padding: small ? '5px 12px' : '9px 18px',
        fontSize: small ? 11 : 13,
      }}
    >
      {children}
    </button>
  );
}

function Badge({ children, color = '#6366f1' }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
      style={{ ...mono, background: `${color}18`, color }}
    >
      {children}
    </span>
  );
}

function Card({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className="rounded-[10px] px-4 py-3.5 transition"
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ' ? onClick() : undefined) : undefined}
      style={{
        background: active ? 'rgba(244,63,94,0.04)' : '#0f172a',
        border: `1px solid ${active ? 'rgba(244,63,94,0.12)' : '#e2e8f0'}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {children}
    </div>
  );
}

function StepDescribe({
  value,
  onChange,
  onAnalyzed,
  onAccept,
  analysisId,
  onAnalysisIdChange,
  postError,
  posting,
}: {
  value: string;
  onChange: (s: string) => void;
  onAnalyzed: (result: ProductIntentExtraction | null) => void;
  onAccept: () => void;
  analysisId: string;
  onAnalysisIdChange: (s: string) => void;
  postError: string | null;
  posting: boolean;
}) {
  const [aiParsing, setAiParsing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<ProductIntentExtraction | null>(null);

  const handleAnalyze = async () => {
    setAnalyzeError(null);
    setAiParsing(true);
    try {
      const res = await extractProductIntent(value.trim(), analysisId.trim() || undefined);
      setAiResult(res);
      onAnalyzed(res);
    } catch (e) {
      setAnalyzeError(
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not analyze your description',
      );
    } finally {
      setAiParsing(false);
    }
  };

  return (
    <div>
      <h2 className="m-0 mb-1.5 text-[17px] font-extrabold text-[#0f172a]" style={mono}>
        Tell us about your app
      </h2>
      <p className="mb-5 text-[13px] leading-relaxed text-[#334155]">
        Describe what your app does and who it&apos;s for in plain English. We&apos;ll use this to understand
        your product intent and map it to what&apos;s in your code.
      </p>
      <label className="mb-1 block text-[11px] text-[#94a3b8]" style={mono}>
        Analysis ID
      </label>
      <input
        value={analysisId}
        onChange={(e) => onAnalysisIdChange(e.target.value)}
        placeholder="UUID from your latest analysis (or ?analysisId= in URL)"
        className="mb-3 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-[#0f172a] outline-none"
        style={font}
      />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='e.g. "My app helps freelance designers find clients, manage their projects, share deliverables, and send invoices…"'
        rows={5}
        className="w-full resize-y rounded-[10px] border border-line bg-page px-4 py-3.5 text-sm leading-relaxed text-[#0f172a] outline-none"
        style={font}
      />
      {postError && <p className="mt-2 text-xs text-danger">{postError}</p>}
      {analyzeError && <p className="mt-2 text-xs text-danger">{analyzeError}</p>}
      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
        <Btn onClick={handleAnalyze} disabled={value.trim().length < 20 || aiParsing || posting}>
          {aiParsing ? 'Understanding your app...' : 'Analyze'}
        </Btn>
        {value.trim().length < 20 && value.trim().length > 0 && (
          <span className="text-[11px] text-[#94a3b8]">Tell us a bit more</span>
        )}
      </div>
      {aiResult && (
        <div
          className="mt-6 rounded-xl border p-5"
          style={{ background: 'rgba(244,63,94,0.03)', borderColor: 'rgba(244,63,94,0.1)' }}
        >
          <div className="mb-3.5 flex items-center gap-2">
            <Badge color="#f43f5e">AI Understanding</Badge>
            <span className="text-[11px] text-[#64748b]">Review and confirm</span>
          </div>
          <p className="mb-4 text-[13px] leading-relaxed text-[#64748b]">{aiResult.domain}</p>
          <div
            className="mb-2 text-[11px] font-bold uppercase text-[#334155]"
            style={{ ...mono, letterSpacing: '0.1em' }}
          >
            Personas we detected
          </div>
          <div className="mb-4 flex flex-wrap gap-2.5">
            {aiResult.personas.map((p) => (
              <div
                key={p.id}
                className="min-w-[200px] flex-1 rounded-lg border border-line bg-page px-3.5 py-2.5"
              >
                <div className="mb-1 text-sm">
                  {p.emoji} <span className="font-semibold text-[#0f172a]">{p.name}</span>
                </div>
                <div className="text-[11px] leading-snug text-[#334155]">{p.description}</div>
              </div>
            ))}
          </div>
          <div
            className="mb-2 text-[11px] font-bold uppercase text-[#334155]"
            style={{ ...mono, letterSpacing: '0.1em' }}
          >
            Jobs they need to do
          </div>
          <div className="mb-4.5 flex flex-col gap-1">
            {aiResult.jobs.map((j) => (
              <div
                key={j.id}
                className="flex items-center gap-2 rounded-md bg-page px-2.5 py-1.5 text-xs text-[#64748b]"
              >
                <span className="shrink-0 text-[10px] text-[#f43f5e]" style={mono}>
                  →
                </span>
                {j.title}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Btn onClick={onAccept} disabled={posting || !analysisId.trim()}>
              {posting ? 'Creating map…' : 'Looks right — continue'}
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                setAiResult(null);
                onAnalyzed(null);
              }}
              disabled={posting}
            >
              Let me edit my description
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function StepPersonas({ personas, setPersonas, onNext }: { personas: Persona[]; setPersonas: (p: Persona[]) => void; onNext: () => void }) {
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [adding, setAdding] = useState(false);

  const confirmPersona = (id: string) => {
    setPersonas(personas.map((p) => (p.id === id ? { ...p, confirmed: true } : p)));
  };
  const removePersona = (id: string) => setPersonas(personas.filter((p) => p.id !== id));
  const addPersona = () => {
    if (!newName.trim()) return;
    setPersonas([
      ...personas,
      {
        id: `p${Date.now()}`,
        name: newName.trim(),
        description: newDesc.trim(),
        emoji: '👤',
        confirmed: true,
      },
    ]);
    setNewName('');
    setNewDesc('');
    setAdding(false);
  };

  const allConfirmed = personas.length > 0 && personas.every((p) => p.confirmed);

  return (
    <div>
      <h2 className="m-0 mb-1.5 text-[17px] font-extrabold text-[#0f172a]" style={mono}>
        Who uses your app?
      </h2>
      <p className="mb-5 text-[13px] leading-relaxed text-[#334155]">
        Confirm the personas we detected, edit them, or add new ones. Each persona will get their own
        set of jobs to be done.
      </p>
      <div className="mb-4 flex flex-col gap-2.5">
        {personas.map((p) => (
          <Card key={p.id} active={p.confirmed}>
            <div className="flex justify-between gap-2">
              <div>
                <div className="mb-0.5 text-sm">
                  {p.emoji} <span className="font-semibold text-[#0f172a]">{p.name}</span>
                  {p.confirmed && (
                    <span className="ml-2">
                      <Badge color="#16a34a">Confirmed</Badge>
                    </span>
                  )}
                </div>
                <div className="text-xs leading-snug text-[#334155]">{p.description}</div>
              </div>
              <div className="ml-2 flex shrink-0 gap-1.5">
                {!p.confirmed && (
                  <Btn small variant="success" onClick={() => confirmPersona(p.id)}>
                    ✓ Confirm
                  </Btn>
                )}
                <Btn small variant="ghost" onClick={() => removePersona(p.id)}>
                  Remove
                </Btn>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {adding ? (
        <div
          className="mb-4 rounded-[10px] border border-line bg-page px-4 py-3.5"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Persona name"
            className="mb-2 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-[#0f172a] outline-none"
            style={font}
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Brief description"
            className="mb-2.5 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-[#0f172a] outline-none"
            style={font}
          />
          <div className="flex gap-2">
            <Btn small onClick={addPersona} disabled={!newName.trim()}>
              Add persona
            </Btn>
            <Btn small variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Btn>
          </div>
        </div>
      ) : (
        <Btn variant="secondary" onClick={() => setAdding(true)}>
          + Add another persona
        </Btn>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Btn onClick={onNext} disabled={!allConfirmed}>
          Continue to jobs
        </Btn>
        {!allConfirmed && (
          <span className="self-center text-[11px] text-[#94a3b8]">Confirm all personas to continue</span>
        )}
      </div>
    </div>
  );
}

function priorityColors() {
  return { high: '#f43f5e', medium: '#d97706', low: '#6b7280' } as const;
}

function StepJobs({
  personas,
  jobs,
  setJobs,
  onBack,
  onNext,
}: {
  personas: Persona[];
  jobs: JobItem[];
  setJobs: (j: JobItem[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const personaIds = personas.map((p) => p.id);
  const [selectedPersona, setSelectedPersona] = useState(personaIds[0] || '');
  const [newJob, setNewJob] = useState('');

  const pc = priorityColors();
  const personaJobs = jobs.filter((j) => j.personaId === selectedPersona);

  const allPersonasHaveJobs = personaIds.every((pid) =>
    jobs.some((j) => j.personaId === pid && j.confirmed),
  );

  return (
    <div>
      <h2 className="m-0 mb-1.5 text-[17px] font-extrabold text-[#0f172a]" style={mono}>
        What do they need to do?
      </h2>
      <p className="mb-5 text-[13px] leading-relaxed text-[#334155]">
        Each persona has jobs to be done — the things they&apos;re trying to accomplish with your app.
        Confirm, prioritize, and add any we missed.
      </p>
      <div className="mb-4.5 flex flex-wrap gap-1.5">
        {personas.map((persona) => {
          const pid = persona.id;
          const pJobs = jobs.filter((j) => j.personaId === pid);
          const conf = pJobs.filter((j) => j.confirmed).length;
          return (
            <button
              key={pid}
              type="button"
              onClick={() => setSelectedPersona(pid)}
              className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold"
              style={{
                ...font,
                background: selectedPersona === pid ? 'rgba(244,63,94,0.1)' : '#f8fafc',
                border: `1px solid ${
                  selectedPersona === pid ? 'rgba(244,63,94,0.2)' : '#e2e8f0'
                }`,
                color: selectedPersona === pid ? '#f43f5e' : '#334155',
                cursor: 'pointer',
              }}
            >
              {persona.emoji} {persona.name}
              <span
                className="rounded-2xl px-1.5 py-0.5 text-[9px] text-[#64748b]"
                style={{ background: '#e2e8f0' }}
              >
                {conf}/{pJobs.length}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mb-3.5 flex flex-col gap-1.5">
        {personaJobs.map((j) => (
          <div
            key={j.id}
            className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5"
            style={{
              background: j.confirmed ? 'rgba(34,197,94,0.03)' : '#0f172a',
              border: `1px solid ${
                j.confirmed ? 'rgba(34,197,94,0.08)' : '#e2e8f0'
              }`,
            }}
          >
            <button
              type="button"
              onClick={() =>
                setJobs(jobs.map((x) => (x.id === j.id ? { ...x, confirmed: !x.confirmed } : x)))
              }
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-[11px] text-success"
              style={{
                borderColor: j.confirmed ? '#16a34a' : '#cbd5e1',
                background: j.confirmed ? 'rgba(34,197,94,0.12)' : 'transparent',
              }}
            >
              {j.confirmed ? '✓' : ''}
            </button>
            <span className="min-w-0 flex-1 text-[13px] font-medium text-[#64748b]">{j.title}</span>
            <button
              type="button"
              onClick={() => {
                const cycle = { high: 'medium' as const, medium: 'low' as const, low: 'high' as const };
                setJobs(
                  jobs.map((x) => (x.id === j.id ? { ...x, priority: cycle[x.priority] } : x)),
                );
              }}
              className="cursor-pointer rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{
                ...mono,
                color: pc[j.priority],
                border: `1px solid ${pc[j.priority]}40`,
                background: `${pc[j.priority]}15`,
              }}
            >
              {j.priority}
            </button>
            <button
              type="button"
              onClick={() => setJobs(jobs.filter((x) => x.id !== j.id))}
              className="px-1 text-sm text-[#cbd5e1] hover:text-[#334155]"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="mb-5 flex gap-2">
        <input
          value={newJob}
          onChange={(e) => setNewJob(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newJob.trim() && selectedPersona) {
              setJobs([
                ...jobs,
                {
                  id: `j${Date.now()}`,
                  personaId: selectedPersona,
                  title: newJob.trim(),
                  priority: 'medium',
                  confirmed: true,
                },
              ]);
              setNewJob('');
            }
          }}
          placeholder="Add a job for this persona…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-2 text-xs text-[#0f172a] outline-none"
          style={font}
        />
        <Btn
          small
          onClick={() => {
            if (!newJob.trim() || !selectedPersona) return;
            setJobs([
              ...jobs,
              {
                id: `j${Date.now()}`,
                personaId: selectedPersona,
                title: newJob.trim(),
                priority: 'medium',
                confirmed: true,
              },
            ]);
            setNewJob('');
          }}
          disabled={!newJob.trim()}
        >
          Add
        </Btn>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Btn variant="ghost" onClick={onBack}>
          Back
        </Btn>
        <Btn onClick={onNext} disabled={!allPersonasHaveJobs}>
          Map to my code
        </Btn>
      </div>
    </div>
  );
}

function StepMapPlaceholder({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div>
      <h2 className="m-0 mb-1.5 text-[17px] font-extrabold text-[#0f172a]" style={mono}>
        Here&apos;s what your app needs
      </h2>
      <p className="mb-5 text-[13px] leading-relaxed text-[#334155]">
        Your product map was created on the server. The detailed job → code matrix will appear in the
        map dashboard. Continue to a sample roadmap, then open the full map.
      </p>
      <div className="flex gap-2.5">
        <Btn variant="ghost" onClick={onBack}>
          Back
        </Btn>
        <Btn onClick={onNext}>
          Show my roadmap
        </Btn>
      </div>
    </div>
  );
}

function StepRoadmapPlaceholder({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  return (
    <div>
      <h2 className="m-0 mb-1.5 text-[17px] font-extrabold text-[#0f172a]" style={mono}>
        Your product roadmap
      </h2>
      <p className="mb-5 text-[13px] leading-relaxed text-[#334155]">
        You&apos;re ready to see readiness scores, module impact, and technical entities in the main
        product map.
      </p>
      <div className="flex flex-wrap gap-2.5">
        <Btn variant="ghost" onClick={onBack}>
          Back to map step
        </Btn>
        <Btn onClick={onDone}>
          Open product map
        </Btn>
      </div>
    </div>
  );
}

export default function ProductMapOnboarding() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(0);
  const [appDescription, setAppDescription] = useState('');
  const [analysisId, setAnalysisId] = useState(searchParams.get('analysisId') || '');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [extractedIntent, setExtractedIntent] = useState<ProductIntentExtraction | null>(null);

  useEffect(() => {
    if (!projectId) return;
    fetchProjectDetail(projectId).catch(() => undefined);
  }, [projectId]);

  if (!projectId) {
    return <div className="min-h-screen bg-[#f8fafc] p-6 text-white">Invalid project.</div>;
  }

  const handleAcceptDescribe = async () => {
    if (!analysisId.trim() || !appDescription.trim()) {
      setPostError('Add an analysis ID and description.');
      return;
    }
    if (!extractedIntent) {
      setPostError('Use Analyze to extract personas and jobs first.');
      return;
    }
    setPostError(null);
    setPosting(true);
    try {
      await createProductMap(projectId, { analysisId: analysisId.trim(), description: appDescription.trim() });
      // User already accepted the extraction ("Looks right — continue"); wizard steps
      // require confirmed personas and confirmed jobs per persona — seed true so the flow is not stuck.
      setPersonas(
        extractedIntent.personas.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          emoji: p.emoji,
          confirmed: true,
        })),
      );
      setJobs(
        extractedIntent.jobs.map((j) => ({
          id: j.id,
          personaId: j.personaId,
          title: j.title,
          priority: j.priority,
          confirmed: true,
        })),
      );
      setStep(1);
    } catch (e) {
      setPostError(
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not create product map',
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      className="min-h-screen text-[#0f172a]"
      style={{ background: '#f8fafc', fontFamily: "'DM Sans', ui-sans-serif, sans-serif" }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-7"
      >
        <div className="flex items-center gap-2">
          <div
            className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-[11px] font-extrabold text-white"
            style={{ background: 'linear-gradient(135deg,#f43f5e,#e11d48)' }}
          >
            T
          </div>
          <span className="text-[13px] font-medium text-[#334155]" style={mono}>
            takeoff<span className="text-[#f43f5e]">/product-map</span>
          </span>
        </div>
        <div className="hidden flex-wrap items-center gap-1 sm:flex">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-1">
              <div
                className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9px] font-bold"
                style={{
                  ...mono,
                  background:
                    i === step ? '#f43f5e' : i < step ? 'rgba(34,197,94,0.12)' : '#f1f5f9',
                  border: `1.5px solid ${
                    i === step ? '#f43f5e' : i < step ? '#16a34a' : '#cbd5e1'
                  }`,
                  color: i === step ? '#0f172a' : i < step ? '#16a34a' : '#cbd5e1',
                }}
              >
                {i < step ? '✓' : i + 1}
              </div>
              {i === step && <span className="max-w-[120px] text-[10px] font-semibold text-[#0f172a]">{label}</span>}
              {i < STEP_LABELS.length - 1 && (
                <div
                  className="hidden h-px w-3 md:block"
                  style={{
                    background: i < step ? 'rgba(34,197,94,0.2)' : '#e2e8f0',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-[680px] px-4 py-6 sm:px-5">
        {step === 0 && (
          <StepDescribe
            value={appDescription}
            onChange={setAppDescription}
            onAnalyzed={(r) => setExtractedIntent(r)}
            onAccept={handleAcceptDescribe}
            analysisId={analysisId}
            onAnalysisIdChange={setAnalysisId}
            postError={postError}
            posting={posting}
          />
        )}
        {step === 1 && (
          <StepPersonas
            personas={personas}
            setPersonas={setPersonas}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <StepJobs
            personas={personas}
            jobs={jobs}
            setJobs={setJobs}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <StepMapPlaceholder onBack={() => setStep(2)} onNext={() => setStep(4)} />
        )}
        {step === 4 && (
          <StepRoadmapPlaceholder
            onBack={() => setStep(3)}
            onDone={() => {
              window.location.href = `/projects/${projectId}/map`;
            }}
          />
        )}
        <p className="mt-8 text-center text-xs text-[#cbd5e1]">
          <Link to={`/projects/${projectId}`} className="text-[#f43f5e] hover:underline">
            Back to project
          </Link>
        </p>
      </div>
    </div>
  );
}
