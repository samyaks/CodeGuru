import { useState } from "react";

/* ═══════════════════════════════════
   DATA MODEL
   ═══════════════════════════════════ */

const INITIAL_STATE = {
  step: 0, // 0=describe, 1=personas, 2=jobs, 3=map, 4=roadmap
  appDescription: "",
  personas: [],
  editingPersona: null,
  jobs: [],
  editingJob: null,
  // Simulated analyzer results
  detectedRoutes: [
    { path: "/", type: "page", label: "Landing page", status: "confirmed" },
    { path: "/login", type: "page", label: "Login page", status: "detected" },
    { path: "/dashboard", type: "page", label: "Dashboard", status: "detected" },
    { path: "/projects", type: "page", label: "Projects list", status: "detected" },
    { path: "/projects/:id", type: "page", label: "Project detail", status: "detected" },
    { path: "/settings", type: "page", label: "Settings", status: "unknown" },
  ],
  detectedCapabilities: [
    { id: "auth", label: "Authentication", status: "partial", detail: "Login form exists, no backend handler" },
    { id: "database", label: "Database", status: "none", detail: "No schema or ORM detected" },
    { id: "payments", label: "Payments", status: "none", detail: "No Stripe or payment code" },
    { id: "email", label: "Email", status: "none", detail: "No email service detected" },
    { id: "deploy", label: "Deployment", status: "none", detail: "No deployment config" },
    { id: "storage", label: "File storage", status: "none", detail: "No upload handling" },
  ],
};

const STEP_LABELS = [
  "Describe your app",
  "Who uses it?",
  "What do they need to do?",
  "Map to your code",
  "Your roadmap",
];

/* ═══════════════════════════════════
   SHARED UI
   ═══════════════════════════════════ */

const font = "'DM Sans', sans-serif";
const mono = "'DM Mono', monospace";

const Btn = ({ children, onClick, variant = "primary", disabled = false, small = false }) => {
  const styles = {
    primary: { bg: "#f43f5e", color: "#fff", border: "none" },
    secondary: { bg: "rgba(255,255,255,.04)", color: "#8a8a9c", border: "1px solid rgba(255,255,255,.08)" },
    ghost: { bg: "transparent", color: "#5a5a6e", border: "1px solid rgba(255,255,255,.06)" },
    success: { bg: "rgba(34,197,94,.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,.15)" },
  };
  const s = styles[variant];
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? "rgba(255,255,255,.03)" : s.bg,
      color: disabled ? "#3a3a4e" : s.color,
      border: s.border, borderRadius: 8,
      padding: small ? "5px 12px" : "9px 18px",
      fontSize: small ? 11 : 13, fontWeight: 600,
      cursor: disabled ? "default" : "pointer",
      fontFamily: font, transition: "all .15s",
    }}>{children}</button>
  );
};

const Badge = ({ children, color = "#818cf8" }) => (
  <span style={{
    fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
    background: `${color}18`, color, fontFamily: mono,
    textTransform: "uppercase", letterSpacing: 1,
  }}>{children}</span>
);

const Card = ({ children, active, onClick }) => (
  <div onClick={onClick} style={{
    background: active ? "rgba(244,63,94,.04)" : "rgba(255,255,255,.02)",
    border: `1px solid ${active ? "rgba(244,63,94,.15)" : "rgba(255,255,255,.05)"}`,
    borderRadius: 10, padding: "14px 16px",
    cursor: onClick ? "pointer" : "default",
    transition: "all .15s",
  }}>{children}</div>
);

/* ═══════════════════════════════════
   STEP 0: DESCRIBE YOUR APP
   ═══════════════════════════════════ */

function StepDescribe({ state, setState }) {
  const [input, setInput] = useState(state.appDescription || "");
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  const handleAnalyze = () => {
    setAiParsing(true);
    // Simulate AI parsing the description
    setTimeout(() => {
      setAiParsing(false);
      setAiResult({
        summary: "A project management platform for freelance designers to find clients, manage projects, and handle invoicing.",
        suggestedPersonas: [
          { name: "Freelance Designer", description: "Independent creative professional looking for clients and managing multiple design projects", emoji: "🎨" },
          { name: "Client", description: "Business owner or marketing manager who needs design work done", emoji: "💼" },
        ],
        suggestedJobs: [
          "Find and attract new clients",
          "Manage active design projects",
          "Share deliverables and get feedback",
          "Send invoices and get paid",
          "Build a portfolio to showcase work",
        ],
        detectedDomain: "Creative services / Freelance",
      });
    }, 1500);
  };

  const handleAccept = () => {
    setState({
      ...state,
      appDescription: input,
      personas: aiResult.suggestedPersonas.map((p, i) => ({ ...p, id: `p${i}`, confirmed: false })),
      step: 1,
    });
  };

  return (
    <div>
      <h2 style={{ fontFamily: mono, fontSize: 17, fontWeight: 800, margin: "0 0 6px", color: "#dcdce6" }}>
        Tell us about your app
      </h2>
      <p style={{ fontSize: 13, color: "#6a6a7e", margin: "0 0 20px", lineHeight: 1.5 }}>
        Describe what your app does and who it's for in plain English. We'll use this to understand your product intent and map it to what's in your code.
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={"e.g. \"My app helps freelance designers find clients, manage their projects, share deliverables, and send invoices. Designers create a portfolio, clients can browse and hire them, and the whole project lifecycle happens in-app.\"\n\nThe more detail you give, the better we can map your product."}
        rows={5}
        style={{
          width: "100%", boxSizing: "border-box",
          background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)",
          borderRadius: 10, padding: "14px 16px", color: "#dcdce6",
          fontSize: 14, fontFamily: font, lineHeight: 1.6,
          outline: "none", resize: "vertical",
        }}
      />

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
        <Btn onClick={handleAnalyze} disabled={input.trim().length < 20 || aiParsing}>
          {aiParsing ? "Understanding your app..." : "Analyze"}
        </Btn>
        {input.trim().length < 20 && input.trim().length > 0 && (
          <span style={{ fontSize: 11, color: "#4a4a60" }}>Tell us a bit more</span>
        )}
      </div>

      {/* AI result */}
      {aiResult && (
        <div style={{
          marginTop: 24, padding: "20px",
          background: "rgba(244,63,94,.03)",
          border: "1px solid rgba(244,63,94,.1)",
          borderRadius: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Badge color="#f43f5e">AI Understanding</Badge>
            <span style={{ fontSize: 11, color: "#5a5a6e" }}>Review and confirm</span>
          </div>

          <p style={{ fontSize: 13, color: "#b8b8c8", lineHeight: 1.6, margin: "0 0 16px" }}>
            {aiResult.summary}
          </p>

          <div style={{ fontSize: 11, fontWeight: 700, color: "#6a6a7e", marginBottom: 8, fontFamily: mono, textTransform: "uppercase", letterSpacing: 1.2 }}>
            Personas we detected
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            {aiResult.suggestedPersonas.map((p, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)",
                borderRadius: 8, padding: "10px 14px", flex: "1 1 200px",
              }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>
                  {p.emoji} <span style={{ fontWeight: 600, color: "#dcdce6" }}>{p.name}</span>
                </div>
                <div style={{ fontSize: 11, color: "#6a6a7e", lineHeight: 1.4 }}>{p.description}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "#6a6a7e", marginBottom: 8, fontFamily: mono, textTransform: "uppercase", letterSpacing: 1.2 }}>
            Jobs they need to do
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 }}>
            {aiResult.suggestedJobs.map((j, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 10px", background: "rgba(255,255,255,.02)",
                borderRadius: 6, fontSize: 12, color: "#b8b8c8",
              }}>
                <span style={{ color: "#f43f5e", fontFamily: mono, fontSize: 10, flexShrink: 0 }}>→</span>
                {j}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={handleAccept}>Looks right — continue</Btn>
            <Btn variant="ghost" onClick={() => setAiResult(null)}>Let me edit my description</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════
   STEP 1: PERSONAS
   ═══════════════════════════════════ */

function StepPersonas({ state, setState }) {
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);

  const confirmPersona = (id) => {
    setState({
      ...state,
      personas: state.personas.map((p) => p.id === id ? { ...p, confirmed: true } : p),
    });
  };

  const removePersona = (id) => {
    setState({ ...state, personas: state.personas.filter((p) => p.id !== id) });
  };

  const addPersona = () => {
    if (!newName.trim()) return;
    setState({
      ...state,
      personas: [...state.personas, {
        id: `p${Date.now()}`, name: newName.trim(),
        description: newDesc.trim(), emoji: "👤", confirmed: true,
      }],
    });
    setNewName(""); setNewDesc(""); setAdding(false);
  };

  const allConfirmed = state.personas.length > 0 && state.personas.every((p) => p.confirmed);

  return (
    <div>
      <h2 style={{ fontFamily: mono, fontSize: 17, fontWeight: 800, margin: "0 0 6px", color: "#dcdce6" }}>
        Who uses your app?
      </h2>
      <p style={{ fontSize: 13, color: "#6a6a7e", margin: "0 0 20px", lineHeight: 1.5 }}>
        Confirm the personas we detected, edit them, or add new ones. Each persona will get their own set of jobs to be done.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {state.personas.map((p) => (
          <Card key={p.id} active={p.confirmed}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 14, marginBottom: 3 }}>
                  {p.emoji} <span style={{ fontWeight: 600, color: "#dcdce6" }}>{p.name}</span>
                  {p.confirmed && <span style={{ marginLeft: 8 }}><Badge color="#22c55e">Confirmed</Badge></span>}
                </div>
                <div style={{ fontSize: 12, color: "#6a6a7e", lineHeight: 1.4 }}>{p.description}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12 }}>
                {!p.confirmed && (
                  <Btn small variant="success" onClick={() => confirmPersona(p.id)}>✓ Confirm</Btn>
                )}
                <Btn small variant="ghost" onClick={() => removePersona(p.id)}>Remove</Btn>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {adding ? (
        <div style={{
          padding: "14px 16px", background: "rgba(255,255,255,.02)",
          border: "1px solid rgba(255,255,255,.08)", borderRadius: 10,
          marginBottom: 16,
        }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Persona name (e.g. Admin, End User)"
            style={{
              width: "100%", boxSizing: "border-box",
              background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
              borderRadius: 6, padding: "8px 12px", color: "#dcdce6",
              fontSize: 13, fontFamily: font, outline: "none", marginBottom: 8,
            }}
          />
          <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Brief description of this persona"
            style={{
              width: "100%", boxSizing: "border-box",
              background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
              borderRadius: 6, padding: "8px 12px", color: "#dcdce6",
              fontSize: 13, fontFamily: font, outline: "none", marginBottom: 10,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Btn small onClick={addPersona} disabled={!newName.trim()}>Add persona</Btn>
            <Btn small variant="ghost" onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        </div>
      ) : (
        <Btn variant="secondary" onClick={() => setAdding(true)}>+ Add another persona</Btn>
      )}

      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <Btn onClick={() => setState({ ...state, step: 2 })} disabled={!allConfirmed}>
          Continue to jobs
        </Btn>
        {!allConfirmed && (
          <span style={{ fontSize: 11, color: "#4a4a60", alignSelf: "center" }}>
            Confirm all personas to continue
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   STEP 2: JOBS TO BE DONE
   ═══════════════════════════════════ */

function StepJobs({ state, setState }) {
  const [selectedPersona, setSelectedPersona] = useState(state.personas[0]?.id || null);
  const [newJob, setNewJob] = useState("");

  // Pre-populate some jobs for demo
  const [jobs, setJobs] = useState([
    { id: "j1", personaId: "p0", title: "Find and attract new clients", priority: "high", confirmed: false },
    { id: "j2", personaId: "p0", title: "Manage active design projects", priority: "high", confirmed: false },
    { id: "j3", personaId: "p0", title: "Share deliverables and get feedback", priority: "medium", confirmed: false },
    { id: "j4", personaId: "p0", title: "Send invoices and get paid", priority: "medium", confirmed: false },
    { id: "j5", personaId: "p0", title: "Build a portfolio to showcase work", priority: "low", confirmed: false },
    { id: "j6", personaId: "p1", title: "Browse and hire designers", priority: "high", confirmed: false },
    { id: "j7", personaId: "p1", title: "Review project deliverables", priority: "medium", confirmed: false },
    { id: "j8", personaId: "p1", title: "Pay for completed work", priority: "medium", confirmed: false },
  ]);

  const personaJobs = jobs.filter((j) => j.personaId === selectedPersona);

  const toggleConfirm = (id) => {
    setJobs(jobs.map((j) => j.id === id ? { ...j, confirmed: !j.confirmed } : j));
  };

  const cyclePriority = (id) => {
    const cycle = { high: "medium", medium: "low", low: "high" };
    setJobs(jobs.map((j) => j.id === id ? { ...j, priority: cycle[j.priority] } : j));
  };

  const removeJob = (id) => setJobs(jobs.filter((j) => j.id !== id));

  const addJob = () => {
    if (!newJob.trim() || !selectedPersona) return;
    setJobs([...jobs, {
      id: `j${Date.now()}`, personaId: selectedPersona,
      title: newJob.trim(), priority: "medium", confirmed: true,
    }]);
    setNewJob("");
  };

  const allConfirmed = personaJobs.length > 0 && personaJobs.every((j) => j.confirmed);
  const allPersonasHaveJobs = state.personas.every((p) => jobs.some((j) => j.personaId === p.id && j.confirmed));

  const priorityColors = { high: "#f43f5e", medium: "#f59e0b", low: "#6b7280" };

  return (
    <div>
      <h2 style={{ fontFamily: mono, fontSize: 17, fontWeight: 800, margin: "0 0 6px", color: "#dcdce6" }}>
        What do they need to do?
      </h2>
      <p style={{ fontSize: 13, color: "#6a6a7e", margin: "0 0 20px", lineHeight: 1.5 }}>
        Each persona has jobs to be done — the things they're trying to accomplish with your app.
        Confirm, prioritize, and add any we missed.
      </p>

      {/* Persona tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {state.personas.map((p) => {
          const pJobs = jobs.filter((j) => j.personaId === p.id);
          const confirmed = pJobs.filter((j) => j.confirmed).length;
          return (
            <button key={p.id} onClick={() => setSelectedPersona(p.id)} style={{
              background: selectedPersona === p.id ? "rgba(244,63,94,.1)" : "rgba(255,255,255,.03)",
              border: `1px solid ${selectedPersona === p.id ? "rgba(244,63,94,.2)" : "rgba(255,255,255,.06)"}`,
              borderRadius: 8, padding: "8px 14px",
              color: selectedPersona === p.id ? "#f43f5e" : "#6a6a7e",
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              {p.emoji} {p.name}
              <span style={{
                fontSize: 9, background: "rgba(255,255,255,.06)",
                padding: "1px 5px", borderRadius: 10, color: "#5a5a6e",
              }}>{confirmed}/{pJobs.length}</span>
            </button>
          );
        })}
      </div>

      {/* Jobs list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
        {personaJobs.map((j) => (
          <div key={j.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px",
            background: j.confirmed ? "rgba(34,197,94,.03)" : "rgba(255,255,255,.02)",
            border: `1px solid ${j.confirmed ? "rgba(34,197,94,.08)" : "rgba(255,255,255,.05)"}`,
            borderRadius: 8,
          }}>
            {/* Confirm toggle */}
            <div onClick={() => toggleConfirm(j.id)} style={{
              width: 20, height: 20, borderRadius: 5, cursor: "pointer",
              border: j.confirmed ? "2px solid #22c55e" : "2px solid rgba(255,255,255,.12)",
              background: j.confirmed ? "rgba(34,197,94,.15)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, color: "#22c55e", flexShrink: 0,
            }}>{j.confirmed ? "✓" : ""}</div>

            {/* Job title */}
            <span style={{ flex: 1, fontSize: 13, color: "#b8b8c8", fontWeight: 500 }}>{j.title}</span>

            {/* Priority */}
            <button onClick={() => cyclePriority(j.id)} style={{
              background: `${priorityColors[j.priority]}15`,
              border: `1px solid ${priorityColors[j.priority]}25`,
              borderRadius: 4, padding: "2px 8px",
              color: priorityColors[j.priority],
              fontSize: 9, fontWeight: 700, cursor: "pointer",
              fontFamily: mono, textTransform: "uppercase", letterSpacing: 1,
            }}>{j.priority}</button>

            {/* Remove */}
            <button onClick={() => removeJob(j.id)} style={{
              background: "none", border: "none", color: "#3a3a4e",
              cursor: "pointer", fontSize: 14, padding: "0 4px",
            }}>×</button>
          </div>
        ))}
      </div>

      {/* Add job */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input value={newJob} onChange={(e) => setNewJob(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addJob(); }}
          placeholder="Add a job this persona needs to do..."
          style={{
            flex: 1, background: "rgba(255,255,255,.03)",
            border: "1px solid rgba(255,255,255,.07)", borderRadius: 8,
            padding: "8px 12px", color: "#dcdce6", fontSize: 12,
            fontFamily: font, outline: "none",
          }}
        />
        <Btn small onClick={addJob} disabled={!newJob.trim()}>Add</Btn>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <Btn variant="ghost" onClick={() => setState({ ...state, step: 1 })}>Back</Btn>
        <Btn onClick={() => setState({ ...state, jobs, step: 3 })} disabled={!allPersonasHaveJobs}>
          Map to my code
        </Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   STEP 3: MAP — the magic moment
   ═══════════════════════════════════ */

function StepMap({ state, setState }) {
  // Simulated mapping from jobs → code + capabilities
  const mapping = [
    {
      job: "Find and attract new clients",
      persona: "🎨 Freelance Designer",
      priority: "high",
      needs: [
        { label: "Landing page", type: "page", status: "exists", match: "/", confidence: 0.95 },
        { label: "Portfolio display", type: "page", status: "missing", match: null, confidence: 0 },
        { label: "Public profile", type: "page", status: "missing", match: null, confidence: 0 },
        { label: "Contact form", type: "feature", status: "missing", match: null, confidence: 0 },
      ],
      modules: [],
    },
    {
      job: "Manage active design projects",
      persona: "🎨 Freelance Designer",
      priority: "high",
      needs: [
        { label: "User authentication", type: "capability", status: "partial", match: "/login", confidence: 0.4, detail: "Form exists, backend missing" },
        { label: "Dashboard", type: "page", status: "exists", match: "/dashboard", confidence: 0.85 },
        { label: "Project CRUD", type: "page", status: "partial", match: "/projects", confidence: 0.6, detail: "List exists, no create/edit" },
        { label: "Database (projects table)", type: "capability", status: "missing", match: null, confidence: 0 },
        { label: "Role-based access", type: "capability", status: "missing", match: null, confidence: 0 },
      ],
      modules: ["auth", "database"],
    },
    {
      job: "Share deliverables and get feedback",
      persona: "🎨 Freelance Designer",
      priority: "medium",
      needs: [
        { label: "File upload", type: "capability", status: "missing", match: null, confidence: 0 },
        { label: "Shareable project link", type: "feature", status: "missing", match: null, confidence: 0 },
        { label: "Feedback/comments", type: "feature", status: "missing", match: null, confidence: 0 },
      ],
      modules: ["storage", "database"],
    },
    {
      job: "Send invoices and get paid",
      persona: "🎨 Freelance Designer",
      priority: "medium",
      needs: [
        { label: "Invoice generation", type: "feature", status: "missing", match: null, confidence: 0 },
        { label: "Stripe payments", type: "capability", status: "missing", match: null, confidence: 0 },
        { label: "Email receipts", type: "capability", status: "missing", match: null, confidence: 0 },
      ],
      modules: ["payments", "email"],
    },
  ];

  const statusColors = { exists: "#22c55e", partial: "#f59e0b", missing: "#ef4444" };
  const statusLabels = { exists: "Built", partial: "Partial", missing: "Not built" };

  return (
    <div>
      <h2 style={{ fontFamily: mono, fontSize: 17, fontWeight: 800, margin: "0 0 6px", color: "#dcdce6" }}>
        Here's what your app needs
      </h2>
      <p style={{ fontSize: 13, color: "#6a6a7e", margin: "0 0 20px", lineHeight: 1.5 }}>
        We mapped each job to what exists in your code and what's missing. Green means built, yellow means partially there, red means not yet.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {mapping.map((m, mi) => (
          <div key={mi} style={{
            background: "rgba(255,255,255,.02)",
            border: "1px solid rgba(255,255,255,.05)",
            borderRadius: 12, overflow: "hidden",
          }}>
            {/* Job header */}
            <div style={{
              padding: "14px 18px",
              borderBottom: "1px solid rgba(255,255,255,.04)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#dcdce6", marginBottom: 2 }}>
                  {m.job}
                </div>
                <span style={{ fontSize: 10, color: "#5a5a6e" }}>{m.persona}</span>
              </div>
              <Badge color={m.priority === "high" ? "#f43f5e" : m.priority === "medium" ? "#f59e0b" : "#6b7280"}>
                {m.priority} priority
              </Badge>
            </div>

            {/* Needs grid */}
            <div style={{ padding: "10px 18px 14px" }}>
              {m.needs.map((n, ni) => (
                <div key={ni} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "7px 0",
                  borderBottom: ni < m.needs.length - 1 ? "1px solid rgba(255,255,255,.03)" : "none",
                }}>
                  {/* Status dot */}
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: statusColors[n.status], flexShrink: 0,
                  }} />

                  {/* Label */}
                  <span style={{ flex: 1, fontSize: 12, color: "#b8b8c8" }}>{n.label}</span>

                  {/* Status badge */}
                  <span style={{
                    fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                    background: `${statusColors[n.status]}12`,
                    color: statusColors[n.status], fontFamily: mono,
                  }}>{statusLabels[n.status]}</span>

                  {/* Match */}
                  {n.match && (
                    <span style={{
                      fontSize: 10, color: "#4a4a60", fontFamily: mono,
                      background: "rgba(255,255,255,.03)", padding: "2px 6px", borderRadius: 3,
                    }}>{n.match}</span>
                  )}
                </div>
              ))}

              {/* Required modules */}
              {m.modules.length > 0 && (
                <div style={{
                  marginTop: 10, padding: "8px 10px",
                  background: "rgba(244,63,94,.03)", borderRadius: 6,
                  border: "1px solid rgba(244,63,94,.08)",
                  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                }}>
                  <span style={{ fontSize: 10, color: "#f43f5e", fontWeight: 600 }}>Needs:</span>
                  {m.modules.map((mod) => (
                    <span key={mod} style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                      background: "rgba(244,63,94,.1)", color: "#f43f5e", fontFamily: mono,
                    }}>{mod} module</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <Btn variant="ghost" onClick={() => setState({ ...state, step: 2 })}>Back</Btn>
        <Btn onClick={() => setState({ ...state, step: 4 })}>Show my roadmap</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   STEP 4: ROADMAP
   ═══════════════════════════════════ */

function StepRoadmap({ state, setState }) {
  const phases = [
    {
      name: "Now — Get feedback on what you have",
      module: "annotate",
      free: true,
      description: "Your landing page, login, dashboard, and project list exist. Before building more, collect feedback on what's there.",
      unblocks: ["Find and attract new clients (validation)", "Manage active design projects (feedback)"],
      effort: "5 minutes",
    },
    {
      name: "Phase 1 — Let users sign up",
      module: "auth",
      free: false,
      description: "Your login page exists but has no backend. Adding auth unlocks every job that requires 'knowing who the user is.'",
      unblocks: ["Manage active design projects", "Share deliverables and get feedback"],
      effort: "~15 minutes with Takeoff",
    },
    {
      name: "Phase 2 — Store their data",
      module: "database",
      free: false,
      description: "Projects, portfolios, deliverables — everything your users create needs to persist. This adds tables with proper security.",
      unblocks: ["Manage active design projects", "Build a portfolio to showcase work"],
      effort: "~20 minutes with Takeoff",
    },
    {
      name: "Phase 3 — Go live",
      module: "deploy",
      free: false,
      description: "Your prototype becomes a real product. Deploy with proper env vars, CORS, and SSL.",
      unblocks: ["Find and attract new clients (publicly accessible)"],
      effort: "~10 minutes with Takeoff",
    },
    {
      name: "Phase 4 — Get paid",
      module: "payments",
      free: false,
      description: "Invoicing and payments require Stripe. This adds checkout, subscription management, and webhook handling.",
      unblocks: ["Send invoices and get paid", "Pay for completed work"],
      effort: "~20 minutes with Takeoff",
    },
  ];

  return (
    <div>
      <h2 style={{ fontFamily: mono, fontSize: 17, fontWeight: 800, margin: "0 0 6px", color: "#dcdce6" }}>
        Your product roadmap
      </h2>
      <p style={{ fontSize: 13, color: "#6a6a7e", margin: "0 0 6px", lineHeight: 1.5 }}>
        Based on your personas and jobs, here's the recommended build order. Each phase unblocks specific jobs for your users.
      </p>
      <p style={{ fontSize: 11, color: "#4a4a60", margin: "0 0 22px" }}>
        This isn't a waterfall plan — it's a dependency graph. You can't add payments before deploy, or database before auth.
      </p>

      <div style={{ position: "relative", paddingLeft: 24 }}>
        {/* Vertical line */}
        <div style={{
          position: "absolute", left: 11, top: 8, bottom: 8,
          width: 2, background: "rgba(255,255,255,.06)",
        }} />

        {phases.map((phase, i) => (
          <div key={i} style={{ position: "relative", marginBottom: 20 }}>
            {/* Timeline dot */}
            <div style={{
              position: "absolute", left: -19, top: 6,
              width: 16, height: 16, borderRadius: "50%",
              background: i === 0 ? "#f43f5e" : "rgba(255,255,255,.06)",
              border: i === 0 ? "3px solid rgba(244,63,94,.3)" : "3px solid rgba(255,255,255,.03)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {i === 0 && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#fff" }} />}
            </div>

            <div style={{
              background: i === 0 ? "rgba(244,63,94,.04)" : "rgba(255,255,255,.02)",
              border: `1px solid ${i === 0 ? "rgba(244,63,94,.12)" : "rgba(255,255,255,.05)"}`,
              borderRadius: 10, padding: "16px 18px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#dcdce6" }}>{phase.name}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {phase.free && <Badge color="#22c55e">FREE</Badge>}
                  <Badge color="#818cf8">{phase.module}</Badge>
                </div>
              </div>

              <p style={{ fontSize: 12, color: "#8a8a9c", lineHeight: 1.5, margin: "0 0 10px" }}>
                {phase.description}
              </p>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#4a4a60", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontFamily: mono }}>
                    Unblocks
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {phase.unblocks.map((u, ui) => (
                      <span key={ui} style={{ fontSize: 11, color: "#6a6a7e", display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ color: "#22c55e", fontSize: 9 }}>✓</span> {u}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, color: "#4a4a60", fontFamily: mono, marginBottom: 4 }}>EFFORT</div>
                  <div style={{ fontSize: 12, color: "#b8b8c8", fontWeight: 600 }}>{phase.effort}</div>
                </div>
              </div>

              {i === 0 && (
                <div style={{ marginTop: 14 }}>
                  <Btn>Start with Annotate →</Btn>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <Btn variant="ghost" onClick={() => setState({ ...state, step: 3 })}>Back to map</Btn>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   MAIN
   ═══════════════════════════════════ */

export default function ProductIntelligence() {
  const [state, setState] = useState(INITIAL_STATE);

  const steps = [StepDescribe, StepPersonas, StepJobs, StepMap, StepRoadmap];
  const CurrentStep = steps[state.step];

  return (
    <div style={{
      background: "#0c0c14", minHeight: "100vh", color: "#dcdce6",
      fontFamily: font,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        borderBottom: "1px solid rgba(255,255,255,.06)",
        padding: "18px 28px 14px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 6,
            background: "linear-gradient(135deg,#f43f5e,#e11d48)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 800, color: "#fff",
          }}>T</div>
          <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 500, color: "#6a6a7e" }}>
            takeoff<span style={{ color: "#f43f5e" }}>/product-map</span>
          </span>
        </div>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {STEP_LABELS.map((label, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%",
                background: i === state.step ? "#f43f5e" : i < state.step ? "rgba(34,197,94,.15)" : "rgba(255,255,255,.04)",
                border: `1.5px solid ${i === state.step ? "#f43f5e" : i < state.step ? "#22c55e" : "rgba(255,255,255,.08)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, fontWeight: 700,
                color: i === state.step ? "#fff" : i < state.step ? "#22c55e" : "#3a3a4e",
                fontFamily: mono,
              }}>{i < state.step ? "✓" : i + 1}</div>
              <span style={{
                fontSize: 10, color: i === state.step ? "#dcdce6" : "#3a3a4e",
                fontWeight: i === state.step ? 600 : 400,
                display: i === state.step ? "inline" : "none",
              }}>{label}</span>
              {i < STEP_LABELS.length - 1 && (
                <div style={{
                  width: 16, height: 1,
                  background: i < state.step ? "rgba(34,197,94,.2)" : "rgba(255,255,255,.06)",
                }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 20px" }}>
        <CurrentStep state={state} setState={setState} />
      </div>
    </div>
  );
}
