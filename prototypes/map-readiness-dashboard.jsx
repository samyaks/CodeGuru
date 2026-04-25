import { useState, useMemo } from "react";

const font = "'DM Sans', sans-serif";
const mono = "'DM Mono', monospace";

/* ═══════════════════════════════════
   GRAPH DATA
   ═══════════════════════════════════ */

const GRAPH = {
  personas: [
    { id: "persona:designer", name: "Freelance Designer", emoji: "🎨" },
    { id: "persona:client", name: "Client", emoji: "💼" },
  ],
  jobs: [
    { id: "job:find-clients", personaId: "persona:designer", title: "Find and attract new clients", priority: "high", weight: 3 },
    { id: "job:manage-projects", personaId: "persona:designer", title: "Manage active design projects", priority: "high", weight: 3 },
    { id: "job:share-deliverables", personaId: "persona:designer", title: "Share deliverables and get feedback", priority: "medium", weight: 2 },
    { id: "job:get-paid", personaId: "persona:designer", title: "Send invoices and get paid", priority: "medium", weight: 2 },
    { id: "job:hire-designer", personaId: "persona:client", title: "Browse and hire designers", priority: "high", weight: 3 },
    { id: "job:review-work", personaId: "persona:client", title: "Review project deliverables", priority: "medium", weight: 2 },
  ],
  pages: [
    { id: "page:/", path: "/", label: "Landing page", file: "app/page.tsx" },
    { id: "page:/login", path: "/login", label: "Login page", file: "app/login/page.tsx" },
    { id: "page:/dashboard", path: "/dashboard", label: "Dashboard", file: "app/dashboard/page.tsx" },
    { id: "page:/projects", path: "/projects", label: "Projects list", file: "app/projects/page.tsx" },
    { id: "page:/projects/:id", path: "/projects/:id", label: "Project detail", file: "app/projects/[id]/page.tsx" },
  ],
  routes: [
    { id: "route:POST /api/auth", method: "POST", path: "/api/auth", label: "Login handler", file: "app/api/auth/route.ts", status: "stub" },
    { id: "route:GET /api/projects", method: "GET", path: "/api/projects", label: "List projects", file: null, status: "missing" },
    { id: "route:POST /api/projects", method: "POST", path: "/api/projects", label: "Create project", file: null, status: "missing" },
  ],
  components: [
    { id: "comp:ProjectList", name: "ProjectList", file: "components/ProjectList.tsx", calls: "route:GET /api/projects" },
    { id: "comp:LoginForm", name: "LoginForm", file: "components/LoginForm.tsx", calls: "route:POST /api/auth" },
    { id: "comp:Navbar", name: "Navbar", file: "components/Navbar.tsx", calls: null },
  ],
  capabilities: [
    { id: "cap:auth", label: "Authentication", status: "partial", module: "auth" },
    { id: "cap:database", label: "Database", status: "none", module: "database" },
    { id: "cap:payments", label: "Payments", status: "none", module: "payments" },
    { id: "cap:deploy", label: "Deployment", status: "none", module: "deploy" },
    { id: "cap:storage", label: "File storage", status: "none", module: "storage" },
  ],
  edges: [
    { from: "job:find-clients", to: "page:/", type: "needs" },
    { from: "job:find-clients", to: "cap:deploy", type: "needs" },
    { from: "job:manage-projects", to: "cap:auth", type: "needs" },
    { from: "job:manage-projects", to: "cap:database", type: "needs" },
    { from: "job:manage-projects", to: "page:/dashboard", type: "needs" },
    { from: "job:manage-projects", to: "page:/projects", type: "needs" },
    { from: "job:manage-projects", to: "page:/projects/:id", type: "needs" },
    { from: "job:share-deliverables", to: "cap:storage", type: "needs" },
    { from: "job:share-deliverables", to: "cap:database", type: "needs" },
    { from: "job:get-paid", to: "cap:payments", type: "needs" },
    { from: "job:get-paid", to: "cap:auth", type: "needs" },
    { from: "job:hire-designer", to: "cap:auth", type: "needs" },
    { from: "job:hire-designer", to: "page:/", type: "needs" },
    { from: "job:hire-designer", to: "cap:deploy", type: "needs" },
    { from: "job:review-work", to: "page:/projects/:id", type: "needs" },
    { from: "job:review-work", to: "cap:auth", type: "needs" },
    { from: "page:/dashboard", to: "comp:ProjectList", type: "renders" },
    { from: "page:/login", to: "comp:LoginForm", type: "renders" },
    { from: "comp:ProjectList", to: "route:GET /api/projects", type: "calls" },
    { from: "comp:LoginForm", to: "route:POST /api/auth", type: "calls" },
    { from: "route:POST /api/auth", to: "cap:auth", type: "requires" },
    { from: "route:GET /api/projects", to: "cap:database", type: "requires" },
    { from: "route:POST /api/projects", to: "cap:database", type: "requires" },
  ],
};

/* ═══════════════════════════════════
   SCORING ENGINE
   ═══════════════════════════════════ */

function getEntityStatus(entityId, overrides = {}) {
  if (overrides[entityId]) return overrides[entityId];
  if (entityId.startsWith("cap:")) {
    const cap = GRAPH.capabilities.find(c => c.id === entityId);
    if (!cap) return 0;
    return cap.status === "full" ? 1 : cap.status === "partial" ? 0.4 : 0;
  }
  if (entityId.startsWith("page:")) {
    return GRAPH.pages.find(p => p.id === entityId) ? 1 : 0;
  }
  return 0;
}

function getJobScore(jobId, overrides = {}) {
  const needs = GRAPH.edges.filter(e => e.from === jobId && e.type === "needs");
  if (needs.length === 0) return 0;
  const total = needs.reduce((sum, e) => sum + getEntityStatus(e.to, overrides), 0);
  return Math.round((total / needs.length) * 100);
}

function getAppScore(overrides = {}) {
  const totalWeight = GRAPH.jobs.reduce((s, j) => s + j.weight, 0);
  const weightedSum = GRAPH.jobs.reduce((s, j) => {
    return s + (getJobScore(j.id, overrides) / 100) * j.weight;
  }, 0);
  return Math.round((weightedSum / totalWeight) * 100);
}

function getModuleImpact(moduleId) {
  // What would the score be if this module were fully added?
  const cap = GRAPH.capabilities.find(c => c.module === moduleId);
  if (!cap) return { before: getAppScore(), after: getAppScore(), delta: 0, jobsUnblocked: [] };

  const overrides = { [cap.id]: 1 }; // simulate full status
  const before = getAppScore();
  const after = getAppScore(overrides);

  const jobsUnblocked = GRAPH.jobs
    .filter(j => {
      const scoreBefore = getJobScore(j.id);
      const scoreAfter = getJobScore(j.id, overrides);
      return scoreAfter > scoreBefore;
    })
    .map(j => ({
      ...j,
      before: getJobScore(j.id),
      after: getJobScore(j.id, overrides),
    }));

  return { before, after, delta: after - before, jobsUnblocked };
}

/* ═══════════════════════════════════
   UI COMPONENTS
   ═══════════════════════════════════ */

function ScoreRing({ score, size = 100, stroke = 8, color, label, sublabel }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const scoreColor = color || (score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none"
            stroke="rgba(255,255,255,.05)" strokeWidth={stroke} />
          <circle cx={size/2} cy={size/2} r={r} fill="none"
            stroke={scoreColor} strokeWidth={stroke}
            strokeDasharray={c} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset .8s cubic-bezier(.4,0,.2,1)" }} />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: size * 0.28, fontWeight: 800, color: scoreColor, fontFamily: mono }}>
            {score}
          </span>
          <span style={{ fontSize: size * 0.09, color: "#4a4a60", fontFamily: mono, marginTop: -2 }}>
            / 100
          </span>
        </div>
      </div>
      {label && <span style={{ fontSize: 12, fontWeight: 600, color: "#dcdce6" }}>{label}</span>}
      {sublabel && <span style={{ fontSize: 10, color: "#4a4a60" }}>{sublabel}</span>}
    </div>
  );
}

function MiniBar({ score, width = 50, color }) {
  const c = color || (score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width, height: 4, borderRadius: 2, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", borderRadius: 2, background: c, transition: "width .5s cubic-bezier(.4,0,.2,1)" }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: c, fontFamily: mono, minWidth: 28 }}>{score}%</span>
    </div>
  );
}

function DeltaBadge({ delta }) {
  if (delta === 0) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: "#22c55e",
      fontFamily: mono, display: "inline-flex", alignItems: "center", gap: 2,
    }}>
      +{delta}%
    </span>
  );
}

function ImpactArrow({ before, after }) {
  const c1 = before >= 70 ? "#22c55e" : before >= 40 ? "#f59e0b" : "#ef4444";
  const c2 = after >= 70 ? "#22c55e" : after >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontFamily: mono }}>
      <span style={{ color: c1, fontWeight: 700 }}>{before}%</span>
      <span style={{ color: "#3a3a4e" }}>→</span>
      <span style={{ color: c2, fontWeight: 700 }}>{after}%</span>
    </div>
  );
}

/* ═══════════════════════════════════
   READINESS DASHBOARD VIEW
   ═══════════════════════════════════ */

function ReadinessView() {
  const [hoveredModule, setHoveredModule] = useState(null);
  const appScore = getAppScore();

  const modules = ["auth", "database", "deploy", "payments", "storage"].map(m => ({
    id: m,
    ...getModuleImpact(m),
    cap: GRAPH.capabilities.find(c => c.module === m),
  })).sort((a, b) => b.delta - a.delta);

  const simulatedScore = hoveredModule ? getModuleImpact(hoveredModule).after : appScore;

  return (
    <div>
      {/* Hero score */}
      <div style={{
        display: "flex", alignItems: "center", gap: 32,
        padding: "24px 28px",
        background: "rgba(255,255,255,.015)",
        border: "1px solid rgba(255,255,255,.05)",
        borderRadius: 14, marginBottom: 24,
      }}>
        <ScoreRing
          score={simulatedScore}
          size={120}
          stroke={10}
          label="App Readiness"
          sublabel={hoveredModule ? `with ${hoveredModule} module` : "weighted by job priority"}
        />

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#dcdce6", marginBottom: 12 }}>
            {simulatedScore < 30 ? "Your prototype needs backend infrastructure" :
             simulatedScore < 60 ? "Making progress — key capabilities missing" :
             simulatedScore < 80 ? "Almost there — a few gaps to fill" :
             "Ready to ship"}
          </div>

          {/* Per-persona mini scores */}
          {GRAPH.personas.map(persona => {
            const pJobs = GRAPH.jobs.filter(j => j.personaId === persona.id);
            const overrides = hoveredModule
              ? { [GRAPH.capabilities.find(c => c.module === hoveredModule)?.id]: 1 }
              : {};
            const pScore = Math.round(
              pJobs.reduce((s, j) => s + getJobScore(j.id, overrides), 0) / pJobs.length
            );
            const baseScore = Math.round(
              pJobs.reduce((s, j) => s + getJobScore(j.id), 0) / pJobs.length
            );

            return (
              <div key={persona.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                marginBottom: 6,
              }}>
                <span style={{ fontSize: 14, width: 20 }}>{persona.emoji}</span>
                <span style={{ fontSize: 12, color: "#8a8a9c", width: 140 }}>{persona.name}</span>
                <MiniBar score={pScore} width={80} />
                {hoveredModule && pScore > baseScore && (
                  <span style={{ fontSize: 10, color: "#22c55e", fontFamily: mono }}>
                    +{pScore - baseScore}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Job-level scores */}
      <div style={{
        fontSize: 11, fontWeight: 700, color: "#4a4a60",
        fontFamily: mono, textTransform: "uppercase", letterSpacing: 1.2,
        marginBottom: 10,
      }}>Job readiness</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 28 }}>
        {GRAPH.jobs.map(job => {
          const overrides = hoveredModule
            ? { [GRAPH.capabilities.find(c => c.module === hoveredModule)?.id]: 1 }
            : {};
          const score = getJobScore(job.id, overrides);
          const baseScore = getJobScore(job.id);
          const persona = GRAPH.personas.find(p => p.id === job.personaId);
          const needs = GRAPH.edges.filter(e => e.from === job.id && e.type === "needs");
          const builtCount = needs.filter(e => getEntityStatus(e.to, overrides) >= 1).length;

          return (
            <div key={job.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px",
              background: hoveredModule && score > baseScore ? "rgba(34,197,94,.03)" : "rgba(255,255,255,.02)",
              border: `1px solid ${hoveredModule && score > baseScore ? "rgba(34,197,94,.08)" : "rgba(255,255,255,.05)"}`,
              borderRadius: 8,
              transition: "all .3s",
            }}>
              <span style={{ fontSize: 12, width: 16 }}>{persona?.emoji}</span>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: "#b8b8c8" }}>{job.title}</span>
              <span style={{ fontSize: 10, color: "#4a4a60", fontFamily: mono }}>
                {builtCount}/{needs.length} done
              </span>
              <MiniBar score={score} width={60} />
              {hoveredModule && score > baseScore && <DeltaBadge delta={score - baseScore} />}
            </div>
          );
        })}
      </div>

      {/* Module impact ranking */}
      <div style={{
        fontSize: 11, fontWeight: 700, color: "#4a4a60",
        fontFamily: mono, textTransform: "uppercase", letterSpacing: 1.2,
        marginBottom: 10,
      }}>Module impact — hover to simulate</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {modules.map((mod, i) => {
          const isHovered = hoveredModule === mod.id;
          const statusColors = { none: "#ef4444", partial: "#f59e0b", full: "#22c55e" };

          return (
            <div
              key={mod.id}
              onMouseEnter={() => setHoveredModule(mod.id)}
              onMouseLeave={() => setHoveredModule(null)}
              style={{
                padding: "14px 18px",
                background: isHovered ? "rgba(244,63,94,.04)" : "rgba(255,255,255,.02)",
                border: `1px solid ${isHovered ? "rgba(244,63,94,.15)" : "rgba(255,255,255,.05)"}`,
                borderRadius: 10, cursor: "pointer",
                transition: "all .2s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 800, color: "#f43f5e",
                    fontFamily: mono, width: 18,
                  }}>#{i + 1}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#dcdce6" }}>
                    {mod.cap?.label}
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                    background: `${statusColors[mod.cap?.status]}14`,
                    color: statusColors[mod.cap?.status],
                    fontFamily: mono, textTransform: "uppercase",
                  }}>{mod.cap?.status === "none" ? "Not built" : mod.cap?.status}</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <ImpactArrow before={mod.before} after={mod.after} />
                  <span style={{
                    fontSize: 13, fontWeight: 800, color: "#22c55e",
                    fontFamily: mono,
                    padding: "3px 10px", borderRadius: 6,
                    background: "rgba(34,197,94,.08)",
                  }}>+{mod.delta}%</span>
                </div>
              </div>

              {/* Jobs this module unblocks */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingLeft: 28 }}>
                {mod.jobsUnblocked.map(job => {
                  const persona = GRAPH.personas.find(p => p.id === job.personaId);
                  return (
                    <span key={job.id} style={{
                      fontSize: 10, color: "#6a6a7e",
                      background: "rgba(255,255,255,.03)",
                      padding: "3px 8px", borderRadius: 4,
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}>
                      {persona?.emoji} {job.title}
                      <span style={{ color: "#22c55e", fontFamily: mono, fontSize: 9 }}>
                        {job.before}→{job.after}%
                      </span>
                    </span>
                  );
                })}
              </div>

              {i === 0 && (
                <div style={{
                  marginTop: 10, paddingLeft: 28,
                }}>
                  <button style={{
                    background: "#f43f5e", border: "none", borderRadius: 8,
                    padding: "8px 18px", color: "#fff", fontSize: 12, fontWeight: 600,
                    cursor: "pointer", fontFamily: font,
                  }}>Add {mod.cap?.label} module →</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   JOB DETAIL VIEW
   ═══════════════════════════════════ */

function JobDetailView() {
  const [expandedJob, setExpandedJob] = useState(null);

  return (
    <div>
      {GRAPH.personas.map(persona => {
        const jobs = GRAPH.jobs.filter(j => j.personaId === persona.id);
        return (
          <div key={persona.id} style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: "#dcdce6",
              marginBottom: 10, display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 16 }}>{persona.emoji}</span>
              {persona.name}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {jobs.map(job => {
                const score = getJobScore(job.id);
                const isExpanded = expandedJob === job.id;
                const needs = GRAPH.edges.filter(e => e.from === job.id && e.type === "needs");

                return (
                  <div key={job.id}
                    onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                    style={{
                      background: isExpanded ? "rgba(244,63,94,.04)" : "rgba(255,255,255,.02)",
                      border: `1px solid ${isExpanded ? "rgba(244,63,94,.12)" : "rgba(255,255,255,.05)"}`,
                      borderRadius: 10, padding: "12px 16px", cursor: "pointer",
                      transition: "all .15s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#dcdce6" }}>{job.title}</span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                          background: job.priority === "high" ? "rgba(244,63,94,.1)" : "rgba(245,158,11,.1)",
                          color: job.priority === "high" ? "#f43f5e" : "#f59e0b",
                          fontFamily: mono, textTransform: "uppercase",
                        }}>{job.priority}</span>
                      </div>
                      <MiniBar score={score} width={70} />
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 10 }}>
                        {needs.map((edge, i) => {
                          const status = getEntityStatus(edge.to);
                          const statusLabel = status >= 1 ? "Ready" : status >= 0.3 ? "Partial" : "Missing";
                          const statusColor = status >= 1 ? "#22c55e" : status >= 0.3 ? "#f59e0b" : "#ef4444";

                          // Find what module would fix this
                          let fixModule = null;
                          if (status < 1 && edge.to.startsWith("cap:")) {
                            const cap = GRAPH.capabilities.find(c => c.id === edge.to);
                            fixModule = cap?.module;
                          }

                          // Get technical detail
                          let techDetail = "";
                          if (edge.to.startsWith("page:")) {
                            const page = GRAPH.pages.find(p => p.id === edge.to);
                            techDetail = page?.file || "";
                          } else if (edge.to.startsWith("cap:")) {
                            const cap = GRAPH.capabilities.find(c => c.id === edge.to);
                            techDetail = cap?.label || "";
                          }

                          return (
                            <div key={i} style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "6px 0",
                              borderBottom: i < needs.length - 1 ? "1px solid rgba(255,255,255,.03)" : "none",
                            }}>
                              <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
                              <span style={{ flex: 1, fontSize: 12, color: "#8a8a9c" }}>{techDetail}</span>
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                                background: `${statusColor}14`, color: statusColor,
                                fontFamily: mono,
                              }}>{statusLabel}</span>
                              {fixModule && (
                                <span style={{
                                  fontSize: 9, padding: "2px 6px", borderRadius: 3,
                                  background: "rgba(244,63,94,.08)", color: "#f43f5e",
                                  fontFamily: mono, fontWeight: 600,
                                }}>→ {fixModule} module</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════
   TECHNICAL VIEW
   ═══════════════════════════════════ */

function TechView() {
  const [selected, setSelected] = useState(null);

  const sections = [
    { title: "Pages", icon: "📄", items: GRAPH.pages.map(p => ({ nodeId: p.id, name: p.label, sub: p.file, dot: "#22c55e" })) },
    { title: "API Routes", icon: "⚡", items: GRAPH.routes.map(r => ({ nodeId: r.id, name: `${r.method} ${r.path}`, sub: r.file || "Not created", dot: r.status === "missing" ? "#ef4444" : "#f59e0b" })) },
    { title: "Components", icon: "🧩", items: GRAPH.components.map(c => ({ nodeId: c.id, name: c.name, sub: c.file, dot: "#22c55e" })) },
    { title: "Capabilities", icon: "🔧", items: GRAPH.capabilities.map(c => ({ nodeId: c.id, name: c.label, sub: c.module + " module", dot: c.status === "none" ? "#ef4444" : c.status === "partial" ? "#f59e0b" : "#22c55e" })) },
  ];

  return (
    <div>
      {sections.map(section => (
        <div key={section.title} style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: "#dcdce6",
            marginBottom: 8, display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>{section.icon}</span>
            {section.title}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {section.items.map(item => {
              const isSelected = selected === item.nodeId;
              const fromEdges = GRAPH.edges.filter(e => e.from === item.nodeId);
              const toEdges = GRAPH.edges.filter(e => e.to === item.nodeId);

              return (
                <div key={item.nodeId} onClick={() => setSelected(isSelected ? null : item.nodeId)} style={{
                  background: isSelected ? "rgba(99,102,241,.04)" : "rgba(255,255,255,.02)",
                  border: `1px solid ${isSelected ? "rgba(99,102,241,.12)" : "rgba(255,255,255,.05)"}`,
                  borderRadius: 8, padding: "9px 14px", cursor: "pointer",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: item.dot }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#dcdce6", flex: 1 }}>{item.name}</span>
                    <span style={{ fontSize: 10, color: "#4a4a60", fontFamily: mono }}>{item.sub}</span>
                  </div>

                  {isSelected && (toEdges.length > 0 || fromEdges.length > 0) && (
                    <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 6 }}>
                      {toEdges.map((edge, i) => {
                        const src = [...GRAPH.jobs, ...GRAPH.pages, ...GRAPH.components, ...GRAPH.routes].find(n => n.id === edge.from);
                        const isProd = edge.from.startsWith("job:");
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 11 }}>
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                              background: isProd ? "rgba(244,63,94,.1)" : "rgba(99,102,241,.1)",
                              color: isProd ? "#f43f5e" : "#818cf8", fontFamily: mono,
                            }}>{edge.type}</span>
                            <span style={{ color: isProd ? "#f43f5e" : "#818cf8", fontWeight: 500 }}>
                              {src?.title || src?.name || src?.label}
                            </span>
                          </div>
                        );
                      })}
                      {fromEdges.map((edge, i) => {
                        const tgt = [...GRAPH.capabilities, ...GRAPH.pages, ...GRAPH.components, ...GRAPH.routes].find(n => n.id === edge.to);
                        return (
                          <div key={`f${i}`} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 11 }}>
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                              background: "rgba(99,102,241,.1)", color: "#818cf8", fontFamily: mono,
                            }}>→ {edge.type}</span>
                            <span style={{ color: "#818cf8", fontWeight: 500 }}>{tgt?.title || tgt?.name || tgt?.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════
   MAIN
   ═══════════════════════════════════ */

export default function UnifiedMapV2() {
  const [view, setView] = useState("readiness");
  const appScore = getAppScore();

  const views = [
    { key: "readiness", label: "Readiness", icon: "📊", desc: "Score + module impact", color: "#f43f5e" },
    { key: "jobs", label: "Jobs", icon: "🎯", desc: "By persona & job", color: "#f59e0b" },
    { key: "technical", label: "Technical", icon: "⚙️", desc: "Code & routes", color: "#818cf8" },
  ];

  return (
    <div style={{ background: "#0c0c14", minHeight: "100vh", color: "#dcdce6", fontFamily: font }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        borderBottom: "1px solid rgba(255,255,255,.06)",
        padding: "16px 24px 12px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 6,
              background: "linear-gradient(135deg,#f43f5e,#e11d48)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 800, color: "#fff",
            }}>T</div>
            <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 500, color: "#6a6a7e" }}>
              takeoff<span style={{ color: "#f43f5e" }}>/map</span>
            </span>
            <span style={{ fontSize: 10, color: "#3a3a4e", marginLeft: 4 }}>Freelancer Platform</span>
          </div>

          {/* Global readiness badge */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "5px 12px",
            background: `${appScore >= 70 ? "rgba(34,197,94,.08)" : appScore >= 40 ? "rgba(245,158,11,.08)" : "rgba(239,68,68,.08)"}`,
            border: `1px solid ${appScore >= 70 ? "rgba(34,197,94,.15)" : appScore >= 40 ? "rgba(245,158,11,.15)" : "rgba(239,68,68,.15)"}`,
            borderRadius: 8,
          }}>
            <span style={{ fontSize: 11, color: "#8a8a9c" }}>Readiness</span>
            <span style={{
              fontSize: 14, fontWeight: 800, fontFamily: mono,
              color: appScore >= 70 ? "#22c55e" : appScore >= 40 ? "#f59e0b" : "#ef4444",
            }}>{appScore}%</span>
          </div>
        </div>

        {/* View switcher */}
        <div style={{ display: "flex", gap: 4 }}>
          {views.map(v => (
            <button key={v.key} onClick={() => setView(v.key)} style={{
              background: view === v.key ? `${v.color}12` : "rgba(255,255,255,.02)",
              border: `1px solid ${view === v.key ? `${v.color}25` : "rgba(255,255,255,.05)"}`,
              borderRadius: 8, padding: "8px 16px",
              cursor: "pointer", fontFamily: font,
              display: "flex", alignItems: "center", gap: 8, transition: "all .15s",
            }}>
              <span style={{ fontSize: 13 }}>{v.icon}</span>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 12, fontWeight: view === v.key ? 700 : 500, color: view === v.key ? v.color : "#6a6a7e" }}>{v.label}</div>
                <div style={{ fontSize: 9, color: "#3a3a4e" }}>{v.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px" }}>
        {view === "readiness" && <ReadinessView />}
        {view === "jobs" && <JobDetailView />}
        {view === "technical" && <TechView />}
      </div>
    </div>
  );
}
