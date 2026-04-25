import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { createProductMap } from '../services/productMapApi';
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
    primary: { bg: '#f43f5e', color: '#fff', border: 'none' },
    secondary: { bg: 'rgba(255,255,255,0.04)', color: '#8a8a9c', border: '1px solid rgba(255,255,255,0.08)' },
    ghost: { bg: 'transparent', color: '#5a5a6e', border: '1px solid rgba(255,255,255,0.06)' },
    success: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.15)' },
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
        background: disabled ? 'rgba(255,255,255,0.03)' : s.bg,
        color: disabled ? '#3a3a4e' : s.color,
        border: s.border,
        padding: small ? '5px 12px' : '9px 18px',
        fontSize: small ? 11 : 13,
      }}
    >
      {children}
    </button>
  );
}

function Badge({ children, color = '#818cf8' }: { children: React.ReactNode; color?: string }) {
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
        background: active ? 'rgba(244,63,94,0.04)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.05)'}`,
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
  onAnalyzed: (result: {
    summary: string;
    suggestedPersonas: { name: string; description: string; emoji: string }[];
    suggestedJobs: string[];
    detectedDomain: string;
  }) => void;
  onAccept: () => void;
  analysisId: string;
  onAnalysisIdChange: (s: string) => void;
  postError: string | null;
  posting: boolean;
}) {
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResult, setAiResult] = useState<{
    summary: string;
    suggestedPersonas: { name: string; description: string; emoji: string }[];
    suggestedJobs: string[];
    detectedDomain: string;
  } | null>(null);

  const handleAnalyze = () => {
    setAiParsing(true);
    window.setTimeout(() => {
      setAiParsing(false);
      const res = {
        summary:
          'A project management platform for freelance designers to find clients, manage projects, and handle invoicing.',
        suggestedPersonas: [
          {
            name: 'Freelance Designer',
            description:
              'Independent creative professional looking for clients and managing multiple design projects',
            emoji: '🎨',
          },
          {
            name: 'Client',
            description: 'Business owner or marketing manager who needs design work done',
            emoji: '💼',
          },
        ],
        suggestedJobs: [
          'Find and attract new clients',
          'Manage active design projects',
          'Share deliverables and get feedback',
          'Send invoices and get paid',
          'Build a portfolio to showcase work',
        ],
        detectedDomain: 'Creative services / Freelance',
      };
      setAiResult(res);
      onAnalyzed(res);
    }, 1500);
  };

  return (
    <div>
      <h2 className="m-0 mb-1.5 text-[17px] font-extrabold text-[#dcdce6]" style={mono}>
        Tell us about your app
      </h2>
      <p className="mb-5 text-[13px] leading-relaxed text-[#6a6a7e]">
        Describe what your app does and who it&apos;s for in plain English. We&apos;ll use this to understand
        your product intent and map it to what&apos;s in your code.
      </p>
      <label className="mb-1 block text-[11px] text-[#4a4a60]" style={mono}>
        Analysis ID
      </label>
      <input
        value={analysisId}
        onChange={(e) => onAnalysisIdChange(e.target.value)}
        placeholder="UUID from your latest analysis (or ?analysisId= in URL)"
        className="mb-3 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-[#dcdce6] outline-none"
        style={font}
      />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='e.g. "My app helps freelance designers find clients, manage their projects, share deliverables, and send invoices…"'
        rows={5}
        className="w-full resize-y rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-4 py-3.5 text-sm leading-relaxed text-[#dcdce6] outline-none"
        style={font}
      />
      {postError && <p className="mt-2 text-xs text-red-400">{postError}</p>}
      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
        <Btn onClick={handleAnalyze} disabled={value.trim().length < 20 || aiParsing || posting}>
          {aiParsing ? 'Understanding your app...' : 'Analyze'}
        </Btn>
        {value.trim().length < 20 && value.trim().length > 0 && (
          <span className="text-[11px] text-[#4a4a60]">Tell us a bit more</span>
        )}
      </div>
      {aiResult && (
        <div
          className="mt-6 rounded-xl border p-5"
          style={{ background: 'rgba(244,63,94,0.03)', borderColor: 'rgba(244,63,94,0.1)' }}
        >
          <div className="mb-3.5 flex items-center gap-2">
            <Badge color="#f43f5e">AI Understanding</Badge>
            <span className="text-[11px] text-[#5a5a6e]">Review and confirm</span>
          </div>
          <p className="mb-4 text-[13px] leading-relaxed text-[#b8b8c8]">{aiResult.summary}</p>
          <div
            className="mb-2 text-[11px] font-bold uppercase text-[#6a6a7e]"
            style={{ ...mono, letterSpacing: '0.1em' }}
          >
            Personas we detected
          </div>
          <div className="mb-4 flex flex-wrap gap-2.5">
            {aiResult.suggestedPersonas.map((p, i) => (
              <div
                key={i}
                className="min-w-[200px] flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
              >
                <div className="mb-1 text-sm">
                  {p.emoji} <span className="font-semibold text-[#dcdce6]">{p.name}</span>
                </div>
                <div className="text-[11px] leading-snug text-[#6a6a7e]">{p.description}</div>
              </div>
            ))}
          </div>
          <div
            className="mb-2 text-[11px] font-bold uppercase text-[#6a6a7e]"
            style={{ ...mono, letterSpacing: '0.1em' }}
          >
            Jobs they need to do
          </div>
          <div className="mb-4.5 flex flex-col gap-1">
            {aiResult.suggestedJobs.map((j, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md bg-white/[0.02] px-2.5 py-1.5 text-xs text-[#b8b8c8]"
              >
                <span className="shrink-0 text-[10px] text-[#f43f5e]" style={mono}>
                  →
                </span>
                {j}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Btn onClick={onAccept} disabled={posting || !analysisId.trim()}>
              {posting ? 'Creating map…' : 'Looks right — continue'}
            </Btn>
            <Btn variant="ghost" onClick={() => setAiResult(null)} disabled={posting}>
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
      <h2 className="m-0 mb-1.5 text-[17px] font-extrabold text-[#dcdce6]" style={mono}>
        Who uses your app?
      </h2>
      <p className="mb-5 text-[13px] leading-relaxed text-[#6a6a7e]">
        Confirm the personas we detected, edit them, or add new ones. Each persona will get their own
        set of jobs to be done.
      </p>
      <div className="mb-4 flex flex-col gap-2.5">
        {personas.map((p) => (
          <Card key={p.id} active={p.confirmed}>
            <div className="flex justify-between gap-2">
              <div>
                <div className="mb-0.5 text-sm">
                  {p.emoji} <span className="font-semibold text-[#dcdce6]">{p.name}</span>
                  {p.confirmed && (
                    <span className="ml-2">
                      <Badge color="#22c55e">Confirmed</Badge>
                    </span>
                  )}
                </div>
                <div className="text-xs leading-snug text-[#6a6a7e]">{p.description}</div>
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
          className="mb-4 rounded-[10px] border border-white/[0.08] bg-white/[0.02] px-4 py-3.5"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Persona name"
            className="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-[#dcdce6] outline-none"
            style={font}
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Brief description"
            className="mb-2.5 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-[#dcdce6] outline-none"
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
          <span className="self-center text-[11px] text-[#4a4a60]">Confirm all personas to continue</span>
        )}
      </div>
    </div>
  );
}

function priorityColors() {
  return { high: '#f43f5e', medium: '#f59e0b', low: '#6b7280' } as const;
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
      <h2 className="m-0 mb-1.5 text-[17px] font-extrabold text-[#dcdce6]" style={mono}>
        What do they need to do?
      </h2>
      <p className="mb-5 text-[13px] leading-relaxed text-[#6a6a7e]">
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
                background: selectedPersona === pid ? 'rgba(244,63,94,0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${
                  selectedPersona === pid ? 'rgba(244,63,94,0.2)' : 'rgba(255,255,255,0.06)'
                }`,
                color: selectedPersona === pid ? '#f43f5e' : '#6a6a7e',
                cursor: 'pointer',
              }}
            >
              {persona.emoji} {persona.name}
              <span
                className="rounded-2xl px-1.5 py-0.5 text-[9px] text-[#5a5a6e]"
                style={{ background: 'rgba(255,255,255,0.06)' }}
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
              background: j.confirmed ? 'rgba(34,197,94,0.03)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${
                j.confirmed ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.05)'
              }`,
            }}
          >
            <button
              type="button"
              onClick={() =>
                setJobs(jobs.map((x) => (x.id === j.id ? { ...x, confirmed: !x.confirmed } : x)))
              }
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-[11px] text-emerald-500"
              style={{
                borderColor: j.confirmed ? '#22c55e' : 'rgba(255,255,255,0.12)',
                background: j.confirmed ? 'rgba(34,197,94,0.15)' : 'transparent',
              }}
            >
              {j.confirmed ? '✓' : ''}
            </button>
            <span className="min-w-0 flex-1 text-[13px] font-medium text-[#b8b8c8]">{j.title}</span>
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
              className="px-1 text-sm text-[#3a3a4e] hover:text-[#6a6a7e]"
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
          className="min-w-0 flex-1 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs text-[#dcdce6] outline-none"
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
      <h2 className="m-0 mb-1.5 text-[17px] font-extrabold text-[#dcdce6]" style={mono}>
        Here&apos;s what your app needs
      </h2>
      <p className="mb-5 text-[13px] leading-relaxed text-[#6a6a7e]">
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
      <h2 className="m-0 mb-1.5 text-[17px] font-extrabold text-[#dcdce6]" style={mono}>
        Your product roadmap
      </h2>
      <p className="mb-5 text-[13px] leading-relaxed text-[#6a6a7e]">
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
  const [analyzed, setAnalyzed] = useState<{
    suggestedPersonas: { name: string; description: string; emoji: string }[];
  } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    fetchProjectDetail(projectId).catch(() => undefined);
  }, [projectId]);

  if (!projectId) {
    return <div className="min-h-screen bg-[#0c0c14] p-6 text-white">Invalid project.</div>;
  }

  const handleAcceptDescribe = async () => {
    if (!analysisId.trim() || !appDescription.trim()) {
      setPostError('Add an analysis ID and description.');
      return;
    }
    setPostError(null);
    setPosting(true);
    try {
      await createProductMap(projectId, { analysisId: analysisId.trim(), description: appDescription.trim() });
      const pList: Persona[] = (analyzed?.suggestedPersonas || []).map((p, i) => ({
        id: `persona-${i}`,
        name: p.name,
        description: p.description,
        emoji: p.emoji,
        confirmed: false,
      }));
      setPersonas(pList);
      const pid0 = pList[0]?.id;
      const pid1 = pList[1]?.id;
      if (pid0) {
        setJobs([
          { id: 'j1', personaId: pid0, title: 'Find and attract new clients', priority: 'high', confirmed: false },
          { id: 'j2', personaId: pid0, title: 'Manage active design projects', priority: 'high', confirmed: false },
          { id: 'j3', personaId: pid0, title: 'Share deliverables and get feedback', priority: 'medium', confirmed: false },
          { id: 'j4', personaId: pid0, title: 'Send invoices and get paid', priority: 'medium', confirmed: false },
          { id: 'j5', personaId: pid0, title: 'Build a portfolio to showcase work', priority: 'low', confirmed: false },
          ...(pid1
            ? [
                { id: 'j6', personaId: pid1, title: 'Browse and hire designers', priority: 'high' as const, confirmed: false },
                { id: 'j7', personaId: pid1, title: 'Review project deliverables', priority: 'medium' as const, confirmed: false },
                { id: 'j8', personaId: pid1, title: 'Pay for completed work', priority: 'medium' as const, confirmed: false },
              ]
            : []),
        ]);
      }
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
      className="min-h-screen text-[#dcdce6]"
      style={{ background: '#0c0c14', fontFamily: "'DM Sans', ui-sans-serif, sans-serif" }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5 sm:px-7"
      >
        <div className="flex items-center gap-2">
          <div
            className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-[11px] font-extrabold text-white"
            style={{ background: 'linear-gradient(135deg,#f43f5e,#e11d48)' }}
          >
            T
          </div>
          <span className="text-[13px] font-medium text-[#6a6a7e]" style={mono}>
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
                    i === step ? '#f43f5e' : i < step ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1.5px solid ${
                    i === step ? '#f43f5e' : i < step ? '#22c55e' : 'rgba(255,255,255,0.08)'
                  }`,
                  color: i === step ? '#fff' : i < step ? '#22c55e' : '#3a3a4e',
                }}
              >
                {i < step ? '✓' : i + 1}
              </div>
              {i === step && <span className="max-w-[120px] text-[10px] font-semibold text-[#dcdce6]">{label}</span>}
              {i < STEP_LABELS.length - 1 && (
                <div
                  className="hidden h-px w-3 md:block"
                  style={{
                    background: i < step ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)',
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
            onAnalyzed={(r) => setAnalyzed(r)}
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
        <p className="mt-8 text-center text-xs text-[#3a3a4e]">
          <Link to={`/projects/${projectId}`} className="text-[#f43f5e] hover:underline">
            Back to project
          </Link>
        </p>
      </div>
    </div>
  );
}
