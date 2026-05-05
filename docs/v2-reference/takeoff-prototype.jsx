import React, { useState } from 'react';
import { ChevronDown, Zap, Brain, Github, Folder, Copy, CheckCircle, ArrowRight, Sparkles, MessageCircle, Edit2, Lightbulb, AlertOctagon, Wrench, Server, Check, X, Wand2, Users, Briefcase, FileText, ClipboardList, GitCommit, ExternalLink, Clock, AlertTriangle, Circle, ChevronUp } from 'lucide-react';

export default function TakeoffDashboard() {
  const [view, setView] = useState('intake');
  const [intent, setIntent] = useState('build');
  const [intakeMode, setIntakeMode] = useState('describe');
  const [projectBrief, setProjectBrief] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [routesPaste, setRoutesPaste] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [projectData, setProjectData] = useState(null);
  
  const [activeSection, setActiveSection] = useState('gaps');
  
  const [gapFilter, setGapFilter] = useState('untriaged'); // untriaged | all | rejected
  const [gapStatus, setGapStatus] = useState({}); // { gapId: 'in-progress' | 'rejected' | 'shipped' }
  const [refiningGap, setRefiningGap] = useState(null);
  const [refinePrompt, setRefinePrompt] = useState('');
  const [copiedGap, setCopiedGap] = useState(null);
  const [expandedGap, setExpandedGap] = useState(null);
  
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', text: "I've analyzed your project. Ask me about any gap, or how to prioritize." }
  ]);

  const analyzeProject = () => {
    setAnalyzing(true);
    setTimeout(() => {
      setProjectData({
        title: 'CodeGuru',
        type: 'Web app — Code analysis platform',
        brief: projectBrief || 'GitHub repo analysis tool',
        readiness: 72,
        stack: {
          runtime: 'Node.js + TypeScript',
          backend: 'FastAPI',
          frontend: 'React + Vite',
          database: 'Postgres',
          deploy: 'Railway',
        },
        personas: [
          { name: 'Product Manager', icon: '📋', readiness: 93, jobs: 4 },
          { name: 'Engineering Manager', icon: '⚙️', readiness: 82, jobs: 4 },
          { name: 'Tech Lead', icon: '👷', readiness: 78, jobs: 5 },
          { name: 'Startup Founder', icon: '🚀', readiness: 82, jobs: 4 },
        ],
        gaps: {
          broken: [
            {
              id: 'b1',
              title: 'No input validation on API routes',
              description: 'API routes accept requests but no validation library (zod, joi, yup) is in use. Bad input can crash the app or open security holes.',
              effort: 'Medium',
              files: 38,
              affects: ['Tech Lead'],
              prompt: `Add input validation to all API routes.\n\nContext: Your project has 38 API route files in app/server/routes/ with no validation layer.\n\nRequirements:\n1. Install zod\n2. Add request body schemas for each route\n3. Validate at the top of each handler\n4. Return 400 with helpful error on validation failure\n5. Type-safe inference for handler bodies\n\nStart with /api/analyze, /api/projects, /api/build-story — these are highest-traffic.`,
            },
            {
              id: 'b2',
              title: 'Hardcoded localhost URLs in source',
              description: '22 hardcoded localhost references will break in production. Use environment variables for all URLs.',
              effort: 'Quick fix',
              files: 22,
              affects: ['Engineering Manager'],
              prompt: `Replace all hardcoded localhost URLs with environment variables.\n\nFound 22 references across the codebase. Use process.env.API_URL (or VITE_API_URL for client).\n\nRequirements:\n1. Add API_URL and CLIENT_URL to .env.example\n2. Replace every localhost:3000, localhost:5173, http://localhost reference\n3. Add fallback for local dev: process.env.API_URL || 'http://localhost:3000'\n4. Update README with env setup instructions`,
            },
            {
              id: 'b3',
              title: 'Environment variables used without validation',
              description: 'process.env reads are not validated at startup — missing variables cause confusing runtime crashes instead of failing fast.',
              effort: 'Quick fix',
              files: 10,
              affects: ['Engineering Manager'],
              prompt: `Validate environment variables at startup.\n\nUse zod or envalid to assert all required env vars are present before the app boots.\n\nRequirements:\n1. Create app/server/config/env.ts with a schema\n2. Validate on import\n3. Export typed env object — replace direct process.env reads throughout codebase\n4. Fail fast with a clear error message listing missing vars`,
            },
          ],
          missing: [
            {
              id: 'm1',
              title: 'Decision reports for leadership',
              description: 'Engineering Managers need exportable decision summaries to share upward. Currently 74% built — missing PDF export and email delivery.',
              effort: 'Medium',
              completion: 74,
              affects: ['Engineering Manager', 'Tech Lead'],
              prompt: `Complete decision reports feature for leadership.\n\nWhat exists: Report generation in /api/reports works, HTML preview renders.\n\nMissing:\n1. PDF export (use puppeteer or pdfkit)\n2. Email delivery (need email module first — see infrastructure gap i1)\n3. Scheduled weekly digest option\n\nStart with PDF export — that unlocks 80% of the value.`,
            },
            {
              id: 'm2',
              title: 'Share decision context with stakeholders',
              description: 'Product Managers can\'t share decision context outside the app. Sharing flow is 70% built — needs public link generation and access control.',
              effort: 'Small',
              completion: 70,
              affects: ['Product Manager'],
              prompt: `Add public sharing for decision contexts.\n\nWhat exists: Internal sharing within team works.\n\nBuild:\n1. "Share publicly" button generates a unique slug\n2. Public URL: /public/decision/:slug renders read-only view\n3. Optional password protection\n4. Expiry option (7 days, 30 days, never)\n5. Track view count (basic)`,
            },
          ],
          infra: [
            {
              id: 'i1',
              title: 'Email — not built',
              description: 'No email module detected. Required for: notification workflows, password reset, decision report delivery.',
              effort: 'Medium',
              required_for: ['Notifications', 'Password reset', 'Report delivery'],
              prompt: `Set up an email module from scratch.\n\nUse Resend (simple, modern API) or Postmark (more reliable for transactional).\n\nBuild:\n1. packages/email module with send() function\n2. Template system (React Email recommended)\n3. Three initial templates: welcome, password-reset, weekly-digest\n4. Queue with retries for failed sends\n5. Local dev mode that logs to console instead of sending`,
            },
            {
              id: 'i2',
              title: 'Payments — not built',
              description: 'No payments integration. Required if you plan to monetize. Stripe Checkout recommended for SaaS.',
              effort: 'Medium',
              required_for: ['Monetization', 'Subscription billing'],
              prompt: `Set up Stripe for SaaS subscriptions.\n\nBuild:\n1. Stripe Checkout integration for subscription start\n2. Customer portal for self-serve management\n3. Webhook handler for events (subscription.created, .updated, .deleted, invoice.paid, .failed)\n4. Sync subscription state to your User table\n5. Middleware to gate features by plan tier`,
            },
            {
              id: 'i3',
              title: 'File Storage — not built',
              description: 'No file storage layer. Required for: user uploads, exported reports, generated artifacts.',
              effort: 'Small',
              required_for: ['User uploads', 'Report exports'],
              prompt: `Set up file storage with S3-compatible API.\n\nUse Cloudflare R2 (cheap, S3-compatible) or Supabase Storage (if you're already on Supabase).\n\nBuild:\n1. packages/storage module with upload(), getSignedUrl(), delete()\n2. Multipart upload support for files > 10MB\n3. Antivirus scanning on upload (ClamAV or Cloudflare's built-in)\n4. Cleanup job for orphaned files`,
            },
          ],
        },
        // Mock recently shipped items (for the Shipped tab demo)
        shipped: [
          {
            id: 's1',
            title: 'Add zod for input validation',
            originalGapId: 'pre-b1',
            commit: '3d3d39b9',
            commitMessage: 'feat: add zod validation across API routes',
            filesChanged: 38,
            verification: 'verified',
            verificationDetail: 'All 38 routes now have request schemas',
            shippedAt: 'Yesterday, 4:22pm',
            deployedTo: 'Railway',
          },
          {
            id: 's2',
            title: 'Build Story share links',
            originalGapId: 'pre-m4',
            commit: '00bd8d4',
            commitMessage: 'feat: add public share link generation',
            filesChanged: 12,
            verification: 'verified',
            verificationDetail: 'Public routes deployed and tested',
            shippedAt: 'Yesterday, 11:08am',
            deployedTo: 'Railway',
          },
          {
            id: 's3',
            title: 'Environment variable validation',
            originalGapId: 'pre-b3',
            commit: 'a4f9c2',
            commitMessage: 'fix: validate env vars at startup',
            filesChanged: 8,
            verification: 'partial',
            verificationDetail: '2 of 10 files still read process.env directly',
            partialItems: ['app/server/db.ts', 'packages/auth/index.js'],
            shippedAt: '2 hours ago',
            deployedTo: null,
          },
          {
            id: 's4',
            title: 'Suggestions UI — full page view',
            originalGapId: 'pre-m5',
            commit: 'd3d39b9',
            commitMessage: 'feat: add suggestions UI — full page view, report tab, dashboard badges',
            filesChanged: 23,
            verification: 'pending',
            verificationDetail: 'Re-scanning to confirm all suggestion paths render',
            shippedAt: 'Just now',
            deployedTo: null,
          },
        ]
      });
      setAnalyzing(false);
      setView('project');
    }, 1200);
  };

  const acceptGap = (gapId) => {
    setGapStatus(prev => ({ ...prev, [gapId]: 'in-progress' }));
    setExpandedGap(gapId);
  };

  const markCommitted = (gapId) => {
    setGapStatus(prev => ({ ...prev, [gapId]: 'shipped' }));
    setExpandedGap(null);
  };

  const rejectGap = (gapId) => {
    setGapStatus(prev => ({ ...prev, [gapId]: 'rejected' }));
  };

  const restoreGap = (gapId) => {
    setGapStatus(prev => {
      const next = { ...prev };
      delete next[gapId];
      return next;
    });
  };

  const startRefine = (gapId) => {
    setRefiningGap(gapId);
    setRefinePrompt('');
  };

  const submitRefine = (gapId) => {
    setRefiningGap(null);
    setRefinePrompt('');
  };

  const copyPromptForGap = (gap) => {
    navigator.clipboard.writeText(gap.prompt);
    setCopiedGap(gap.id);
    setTimeout(() => setCopiedGap(null), 2000);
  };

  const sendChatMessage = (presetMsg) => {
    const msg = presetMsg || chatInput;
    if (!msg.trim()) return;
    setChatMessages(prev => [...prev, { role: 'user', text: msg }]);
    setChatInput('');
    setTimeout(() => {
      const responses = {
        'priori': "Start with Broken gaps — they're shipping risks. Then tackle Missing Functionality blocking your weakest persona (Tech Lead at 78%).",
        'verif': "When you commit code, Takeoff re-scans the affected files and checks if the gap criteria are still met. Verified means it's truly fixed; partial means some files were missed.",
        'partial': "Partial verification means your commit addressed some but not all of the gap. Click into the partial item in Shipped to see exactly what's left.",
        'reject': "Rejecting a gap means it won't show up in future audits. Useful when something is intentional.",
      };
      const key = Object.keys(responses).find(k => msg.toLowerCase().includes(k));
      const reply = key ? responses[key] : "Try asking about: priorities, verification, partial commits, or reject reasons.";
      setChatMessages(prev => [...prev, { role: 'assistant', text: reply }]);
    }, 600);
  };

  const sansFont = { fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif' };
  const serifFont = { fontFamily: 'ui-serif, Georgia, Cambria, serif' };

  // Compute gap groupings
  const allGaps = projectData ? [
    ...projectData.gaps.broken.map(g => ({ ...g, category: 'broken' })),
    ...projectData.gaps.missing.map(g => ({ ...g, category: 'missing' })),
    ...projectData.gaps.infra.map(g => ({ ...g, category: 'infra' })),
  ] : [];

  const visibleGaps = allGaps.filter(g => {
    const status = gapStatus[g.id];
    if (gapFilter === 'untriaged') return !status || status === 'in-progress';
    if (gapFilter === 'rejected') return status === 'rejected';
    if (gapFilter === 'all') return true;
    return true;
  });

  const inProgressCount = Object.values(gapStatus).filter(s => s === 'in-progress').length;
  const untriagedCount = allGaps.filter(g => !gapStatus[g.id]).length;
  const rejectedCount = Object.values(gapStatus).filter(s => s === 'rejected').length;

  const categoryMeta = {
    broken: { label: 'Broken', icon: AlertOctagon, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    missing: { label: 'Missing Functionality', icon: Wrench, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
    infra: { label: 'Missing Infrastructure', icon: Server, color: 'text-stone-700', bg: 'bg-stone-100', border: 'border-stone-300' },
  };

  const verificationMeta = {
    verified: { label: 'Verified', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    partial: { label: 'Partial', icon: AlertTriangle, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
    pending: { label: 'Verifying...', icon: Clock, color: 'text-stone-600', bg: 'bg-stone-100', border: 'border-stone-200' },
  };

  // Combine real shipped (from history) + just-marked-shipped gaps
  const shippedFromGaps = allGaps
    .filter(g => gapStatus[g.id] === 'shipped')
    .map(g => ({
      id: 'session-' + g.id,
      title: g.title,
      commit: 'pending',
      commitMessage: 'Awaiting commit...',
      filesChanged: g.files || '?',
      verification: 'pending',
      verificationDetail: 'Waiting for your next commit to verify',
      shippedAt: 'Just now',
      deployedTo: null,
    }));
  
  const allShipped = projectData ? [...shippedFromGaps, ...projectData.shipped] : [];
  const shippedThisSessionCount = shippedFromGaps.length;

  return (
    <div className="min-h-screen bg-stone-50" style={serifFont}>
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-stone-900 rounded flex items-center justify-center">
              <Zap className="w-4 h-4 text-stone-50" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-stone-900 tracking-tight" style={sansFont}>Takeoff</h1>
              <p className="text-xs text-stone-500" style={sansFont}>AI in the loop</p>
            </div>
          </div>
          {projectData && (
            <button 
              onClick={() => { setView('intake'); setProjectData(null); setProjectBrief(''); setGithubUrl(''); setGapStatus({}); setActiveSection('gaps'); setExpandedGap(null); }}
              className="text-sm text-stone-600 hover:text-stone-900 transition-colors"
              style={sansFont}
            >
              + New project
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {view === 'intake' ? (
          <div className="max-w-2xl mx-auto">
            <div className="mb-10">
              <p className="text-xs uppercase tracking-widest text-stone-500 mb-3" style={sansFont}>Step 1 of the loop</p>
              <h2 className="text-5xl font-bold text-stone-900 mb-4 tracking-tight leading-none">
                {intent === 'build' ? 'Start building.' : 'Untangle your app.'}
              </h2>
              <p className="text-lg text-stone-600 leading-relaxed" style={sansFont}>
                {intent === 'build' ? 'Describe your idea, connect a repo, or upload files.' : 'Paste your routes, connect a repo, or upload files.'} Claude analyzes everything and gives you a complete plan.
              </p>
            </div>

            <div className="flex gap-2 mb-5" style={sansFont}>
              <button onClick={() => { setIntent('build'); if (intakeMode === 'paste') setIntakeMode('describe'); }} className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition-all border ${intent === 'build' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-700 border-stone-300 hover:border-stone-400'}`}>
                <div className="text-left">
                  <p className="font-semibold">Build something</p>
                  <p className={`text-xs mt-0.5 ${intent === 'build' ? 'text-stone-300' : 'text-stone-500'}`}>New idea or extend existing app</p>
                </div>
              </button>
              <button onClick={() => setIntent('audit')} className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition-all border ${intent === 'audit' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-700 border-stone-300 hover:border-stone-400'}`}>
                <div className="text-left">
                  <p className="font-semibold">Audit & restructure</p>
                  <p className={`text-xs mt-0.5 ${intent === 'audit' ? 'text-stone-300' : 'text-stone-500'}`}>Existing app feels messy</p>
                </div>
              </button>
            </div>

            <div className="flex gap-1 mb-4 bg-stone-100 p-1 rounded-lg" style={sansFont}>
              {intent === 'build' ? (
                <>
                  <button onClick={() => setIntakeMode('describe')} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${intakeMode === 'describe' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}>
                    <Sparkles className="w-4 h-4" /> Describe
                  </button>
                  <button onClick={() => setIntakeMode('github')} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${intakeMode === 'github' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}>
                    <Github className="w-4 h-4" /> Connect
                  </button>
                  <button onClick={() => setIntakeMode('upload')} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${intakeMode === 'upload' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}>
                    <Folder className="w-4 h-4" /> Upload
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setIntakeMode('paste')} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${intakeMode === 'paste' || intakeMode === 'describe' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}>
                    <ClipboardList className="w-4 h-4" /> Paste routes
                  </button>
                  <button onClick={() => setIntakeMode('github')} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${intakeMode === 'github' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}>
                    <Github className="w-4 h-4" /> Connect repo
                  </button>
                  <button onClick={() => setIntakeMode('upload')} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${intakeMode === 'upload' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}>
                    <Folder className="w-4 h-4" /> Upload
                  </button>
                </>
              )}
            </div>

            <div className="mb-6" style={sansFont}>
              {intakeMode === 'describe' && intent === 'build' && (
                <textarea value={projectBrief} onChange={(e) => setProjectBrief(e.target.value)} placeholder="A Discord bot that summarizes our team standups using Claude. Be clever about tone. Friday at 5pm." className="w-full h-36 px-5 py-4 bg-white border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 text-stone-900 placeholder-stone-400 resize-none text-base leading-relaxed" />
              )}
              {intakeMode === 'paste' && intent === 'audit' && (
                <textarea value={routesPaste} onChange={(e) => setRoutesPaste(e.target.value)} placeholder={`/dashboard\n/projects\n/projects/:id\n/templates\n/billing\n\nFeatures:\n- Project list with filters\n- Templates library`} className="w-full h-48 px-5 py-4 bg-white border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900 text-stone-900 placeholder-stone-400 resize-none text-sm font-mono leading-relaxed" />
              )}
              {intakeMode === 'github' && (
                <input type="text" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/your-name/your-repo" className="w-full px-5 py-4 bg-white border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900 text-stone-900 placeholder-stone-400 text-base" />
              )}
              {intakeMode === 'upload' && (
                <div className="border-2 border-dashed border-stone-300 rounded-lg p-12 text-center bg-white hover:border-stone-400 hover:bg-stone-50 transition-all cursor-pointer">
                  <Folder className="w-10 h-10 text-stone-400 mx-auto mb-3" strokeWidth={1.5} />
                  <p className="text-stone-700 font-medium mb-1">Drop a folder here</p>
                  <p className="text-sm text-stone-500">Or click to browse files</p>
                </div>
              )}
            </div>

            <button onClick={analyzeProject} disabled={analyzing} className="w-full bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white font-semibold py-4 rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-stone-900/10" style={sansFont}>
              {analyzing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Claude is analyzing...
                </>
              ) : (
                <>
                  {intent === 'build' ? 'Analyze & Generate Plan' : 'Audit & Find Gaps'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        ) : (
          <div style={sansFont}>
            {/* Project header */}
            <div className="mb-8">
              <p className="text-xs uppercase tracking-widest text-stone-500 mb-2">Your project</p>
              <div className="flex items-baseline justify-between flex-wrap gap-4 mb-3">
                <h2 className="text-4xl font-bold text-stone-900 tracking-tight" style={serifFont}>
                  {projectData.title}
                </h2>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-stone-500">Readiness</span>
                  <span className="text-2xl font-bold text-stone-900">{projectData.readiness}</span>
                  <span className="text-stone-400">/ 100</span>
                </div>
              </div>
              <p className="text-stone-600 text-sm">{projectData.type}</p>
            </div>

            {/* Section tabs */}
            <div className="border-b border-stone-200 mb-8">
              <div className="flex gap-1">
                {[
                  { id: 'gaps', label: 'Gaps', icon: AlertOctagon, badge: untriagedCount, badgeColor: 'red' },
                  { id: 'map', label: 'Map', icon: Users, badge: null },
                  { id: 'context', label: 'Context', icon: FileText, badge: null },
                  { id: 'shipped', label: 'Shipped', icon: GitCommit, badge: shippedThisSessionCount > 0 ? shippedThisSessionCount : null, badgeColor: 'emerald' },
                ].map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeSection === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveSection(tab.id)}
                      className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all -mb-px ${isActive ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-900'}`}
                    >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                      {tab.badge !== null && tab.badge > 0 && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          isActive 
                            ? (tab.badgeColor === 'emerald' ? 'bg-emerald-500 text-white' : 'bg-stone-900 text-white')
                            : 'bg-stone-100 text-stone-600'
                        }`}>
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              <div className="lg:col-span-3">
                
                {/* ====== GAPS SECTION ====== */}
                {activeSection === 'gaps' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-2xl font-bold text-stone-900 mb-2" style={serifFont}>What's missing or broken</h3>
                      <p className="text-stone-600 text-sm leading-relaxed">
                        Accept gaps to start working on them. The Cursor prompt opens inline — copy it, build, then mark committed. Takeoff will verify it landed.
                      </p>
                    </div>

                    {/* Filter row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setGapFilter('untriaged')} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${gapFilter === 'untriaged' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200 text-stone-700 hover:border-stone-400'}`}>
                        Active <span className={gapFilter === 'untriaged' ? 'text-stone-300' : 'text-stone-400'}>{untriagedCount + inProgressCount}</span>
                      </button>
                      <button onClick={() => setGapFilter('all')} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${gapFilter === 'all' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200 text-stone-700 hover:border-stone-400'}`}>
                        All <span className={gapFilter === 'all' ? 'text-stone-300' : 'text-stone-400'}>{allGaps.length}</span>
                      </button>
                      {rejectedCount > 0 && (
                        <button onClick={() => setGapFilter('rejected')} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${gapFilter === 'rejected' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200 text-stone-700 hover:border-stone-400'}`}>
                          Rejected <span className={gapFilter === 'rejected' ? 'text-stone-300' : 'text-stone-400'}>{rejectedCount}</span>
                        </button>
                      )}
                      
                      {inProgressCount > 0 && (
                        <div className="ml-auto text-xs text-stone-500 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                          {inProgressCount} in progress
                        </div>
                      )}
                    </div>

                    {/* Gap list */}
                    {visibleGaps.length === 0 ? (
                      <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
                        <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-3" />
                        <p className="font-semibold text-stone-900 mb-1">No gaps in this view</p>
                        <p className="text-sm text-stone-600">Switch filters to see other gaps.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {visibleGaps.map(gap => {
                          const meta = categoryMeta[gap.category];
                          const Icon = meta.icon;
                          const status = gapStatus[gap.id];
                          const isInProgress = status === 'in-progress';
                          const isRejected = status === 'rejected';
                          const isExpanded = expandedGap === gap.id;
                          const isRefining = refiningGap === gap.id;
                          
                          return (
                            <div key={gap.id} className={`bg-white border rounded-lg overflow-hidden transition-all ${
                              isInProgress ? 'border-amber-300 ring-2 ring-amber-100' : 
                              isRejected ? 'border-stone-200 opacity-60' :
                              meta.border
                            } hover:shadow-sm`}>
                              <div className="p-5">
                                <div className="flex items-center gap-2 mb-3 flex-wrap">
                                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold ${meta.bg} ${meta.color}`}>
                                    <Icon className="w-3 h-3" />
                                    {meta.label}
                                  </div>
                                  {isInProgress && (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold bg-amber-100 text-amber-800">
                                      <Circle className="w-2 h-2 fill-current" /> In progress
                                    </div>
                                  )}
                                  {isRejected && (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold bg-stone-100 text-stone-600">
                                      <X className="w-3 h-3" /> Rejected
                                    </div>
                                  )}
                                  <span className="text-xs text-stone-500">·</span>
                                  <span className="text-xs text-stone-500">{gap.effort} effort</span>
                                  {gap.files && (
                                    <>
                                      <span className="text-xs text-stone-500">·</span>
                                      <span className="text-xs text-stone-500">{gap.files} files</span>
                                    </>
                                  )}
                                  {gap.completion !== undefined && (
                                    <>
                                      <span className="text-xs text-stone-500">·</span>
                                      <span className="text-xs text-stone-500">{gap.completion}% built</span>
                                    </>
                                  )}
                                </div>

                                <h4 className="font-semibold text-stone-900 mb-1.5">{gap.title}</h4>
                                <p className="text-sm text-stone-600 leading-relaxed mb-3">{gap.description}</p>

                                {gap.affects && (
                                  <div className="flex items-center gap-2 text-xs text-stone-500 mb-4">
                                    <Users className="w-3 h-3" />
                                    <span>Blocks: {gap.affects.join(', ')}</span>
                                  </div>
                                )}
                                {gap.required_for && (
                                  <div className="flex items-center gap-2 text-xs text-stone-500 mb-4">
                                    <Briefcase className="w-3 h-3" />
                                    <span>Required for: {gap.required_for.join(' · ')}</span>
                                  </div>
                                )}

                                {/* In-progress: show prompt inline */}
                                {isInProgress && (
                                  <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
                                    <div className="flex items-center justify-between">
                                      <p className="text-xs uppercase tracking-widest text-stone-500 font-semibold">Cursor prompt</p>
                                      <button onClick={() => setExpandedGap(isExpanded ? null : gap.id)} className="text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1">
                                        {isExpanded ? <>Hide <ChevronUp className="w-3 h-3" /></> : <>Show <ChevronDown className="w-3 h-3" /></>}
                                      </button>
                                    </div>
                                    
                                    {isExpanded && (
                                      <div className="bg-stone-900 rounded-md p-4 max-h-60 overflow-y-auto">
                                        <pre className="text-xs text-stone-300 whitespace-pre-wrap font-mono leading-relaxed">{gap.prompt}</pre>
                                      </div>
                                    )}

                                    <div className="flex items-center gap-2 flex-wrap">
                                      <button onClick={() => copyPromptForGap(gap)} className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-md text-sm font-medium transition-colors">
                                        {copiedGap === gap.id ? (<><CheckCircle className="w-4 h-4" /> Copied</>) : (<><Copy className="w-4 h-4" /> Copy prompt</>)}
                                      </button>
                                      <button className="flex items-center gap-2 px-4 py-2 border border-stone-300 hover:bg-stone-50 text-stone-700 rounded-md text-sm font-medium transition-colors">
                                        <ExternalLink className="w-4 h-4" /> Open in Cursor
                                      </button>
                                      <button onClick={() => markCommitted(gap.id)} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-medium transition-colors ml-auto">
                                        <GitCommit className="w-4 h-4" /> Mark committed
                                      </button>
                                    </div>
                                    <p className="text-xs text-stone-500 italic">After you commit, Takeoff will re-scan the affected files and verify the gap is resolved.</p>
                                  </div>
                                )}

                                {/* Refine input */}
                                {isRefining && !status && (
                                  <div className="mt-4 p-3 bg-stone-50 border border-stone-200 rounded-md">
                                    <p className="text-xs text-stone-600 mb-2 font-medium">Tell Claude how to reshape this gap:</p>
                                    <textarea value={refinePrompt} onChange={(e) => setRefinePrompt(e.target.value)} placeholder="e.g. 'Scope smaller — just protect /api/auth endpoints first'" className="w-full px-3 py-2 text-sm border border-stone-300 rounded focus:outline-none focus:border-stone-900 mb-2 resize-none" rows={2} />
                                    <div className="flex gap-2 justify-end">
                                      <button onClick={() => setRefiningGap(null)} className="text-xs text-stone-600 hover:text-stone-900 px-3 py-1.5">Cancel</button>
                                      <button onClick={() => submitRefine(gap.id)} disabled={!refinePrompt.trim()} className="text-xs bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white px-3 py-1.5 rounded font-medium">Regenerate</button>
                                    </div>
                                  </div>
                                )}

                                {/* Untriaged: Accept/Reject/Refine */}
                                {!status && !isRefining && (
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => acceptGap(gap.id)} className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-md text-sm font-medium transition-colors">
                                      <Check className="w-4 h-4" /> Accept
                                    </button>
                                    <button onClick={() => rejectGap(gap.id)} className="flex items-center gap-2 px-4 py-2 border border-stone-300 hover:bg-stone-50 text-stone-700 rounded-md text-sm font-medium transition-colors">
                                      <X className="w-4 h-4" /> Reject
                                    </button>
                                    <button onClick={() => startRefine(gap.id)} className="flex items-center gap-2 px-4 py-2 border border-stone-300 hover:bg-stone-50 text-stone-700 rounded-md text-sm font-medium transition-colors">
                                      <Wand2 className="w-4 h-4" /> Refine
                                    </button>
                                  </div>
                                )}

                                {/* Rejected: restore option */}
                                {isRejected && (
                                  <button onClick={() => restoreGap(gap.id)} className="text-xs text-stone-600 hover:text-stone-900 font-medium">
                                    Restore this gap
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ====== SHIPPED SECTION ====== */}
                {activeSection === 'shipped' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-2xl font-bold text-stone-900 mb-2" style={serifFont}>What you've shipped</h3>
                      <p className="text-stone-600 text-sm leading-relaxed">
                        Takeoff watches your repo. Every commit gets matched to a gap and verified — we re-scan the affected files to confirm the problem is actually gone.
                      </p>
                    </div>

                    <div className="bg-white border border-stone-200 rounded-lg p-4 flex items-center gap-3">
                      <Github className="w-4 h-4 text-stone-500" />
                      <span className="text-sm text-stone-700">Connected to <span className="font-mono text-stone-900">samyaks/CodeGuru</span></span>
                      <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        Listening for commits
                      </span>
                    </div>

                    <div className="space-y-3">
                      {allShipped.map((item, idx) => {
                        const vMeta = verificationMeta[item.verification];
                        const VIcon = vMeta.icon;
                        return (
                          <div key={item.id} className={`bg-white border ${vMeta.border} rounded-lg p-5`}>
                            <div className="flex items-start justify-between gap-4 mb-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold ${vMeta.bg} ${vMeta.color}`}>
                                    <VIcon className="w-3 h-3" />
                                    {vMeta.label}
                                  </div>
                                  <span className="text-xs text-stone-500">{item.shippedAt}</span>
                                  {item.deployedTo && (
                                    <>
                                      <span className="text-xs text-stone-400">·</span>
                                      <span className="text-xs text-stone-500 flex items-center gap-1">
                                        <ExternalLink className="w-3 h-3" /> {item.deployedTo}
                                      </span>
                                    </>
                                  )}
                                </div>
                                <h4 className="font-semibold text-stone-900 mb-1">{item.title}</h4>
                              </div>
                            </div>

                            <div className="bg-stone-50 border border-stone-200 rounded-md p-3 mb-3">
                              <div className="flex items-center gap-2 text-xs">
                                <GitCommit className="w-3 h-3 text-stone-500 flex-shrink-0" />
                                <span className="font-mono text-stone-700">{item.commit}</span>
                                <span className="text-stone-400">·</span>
                                <span className="text-stone-600 truncate">{item.commitMessage}</span>
                                {item.filesChanged && typeof item.filesChanged === 'number' && (
                                  <>
                                    <span className="text-stone-400">·</span>
                                    <span className="text-stone-500 flex-shrink-0">{item.filesChanged} files</span>
                                  </>
                                )}
                              </div>
                            </div>

                            <p className="text-xs text-stone-600 mb-3">
                              <strong className={vMeta.color}>{vMeta.label}:</strong> {item.verificationDetail}
                            </p>

                            {item.verification === 'partial' && item.partialItems && (
                              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-3">
                                <p className="text-xs font-semibold text-amber-900 mb-2">Still missing in:</p>
                                <ul className="space-y-1">
                                  {item.partialItems.map(file => (
                                    <li key={file} className="text-xs font-mono text-amber-800 flex items-center gap-1.5">
                                      <span className="w-1 h-1 rounded-full bg-amber-500"></span>
                                      {file}
                                    </li>
                                  ))}
                                </ul>
                                <button className="text-xs text-amber-900 hover:text-amber-950 font-medium mt-2">
                                  Re-open as new gap →
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {allShipped.length === 0 && (
                      <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
                        <GitCommit className="w-8 h-8 text-stone-400 mx-auto mb-3" />
                        <p className="font-semibold text-stone-900 mb-1">Nothing shipped yet</p>
                        <p className="text-sm text-stone-600">Accept a gap, commit your work, and it'll appear here verified.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ====== MAP SECTION ====== */}
                {activeSection === 'map' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-2xl font-bold text-stone-900 mb-2" style={serifFont}>Who it's for, what they need</h3>
                      <p className="text-stone-600 text-sm leading-relaxed">Personas Claude detected, weighted by how much your code already supports their jobs.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {projectData.personas.map(persona => (
                        <div key={persona.name} className="bg-white border border-stone-200 rounded-lg p-5 hover:border-stone-300 transition-colors">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="text-2xl">{persona.icon}</div>
                              <div>
                                <p className="font-semibold text-stone-900">{persona.name}</p>
                                <p className="text-xs text-stone-500">{persona.jobs} jobs to be done</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-stone-900">{persona.readiness}<span className="text-sm text-stone-400">%</span></p>
                              <p className="text-xs text-stone-500">ready</p>
                            </div>
                          </div>
                          <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${persona.readiness >= 90 ? 'bg-emerald-500' : persona.readiness >= 75 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${persona.readiness}%` }} />
                          </div>
                          <button className="mt-3 text-xs text-stone-600 hover:text-stone-900 font-medium flex items-center gap-1">
                            <Edit2 className="w-3 h-3" /> Edit jobs
                          </button>
                        </div>
                      ))}
                      <button className="bg-stone-50 border border-dashed border-stone-300 rounded-lg p-5 hover:border-stone-400 hover:bg-stone-100 transition-all flex items-center justify-center text-stone-500 text-sm font-medium">
                        + Add persona
                      </button>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
                      <Lightbulb className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-900 leading-relaxed">
                        <strong>Tech Lead is your weakest persona</strong> at 78%. The Missing Functionality gaps that affect them are likely your highest-impact fixes.
                      </div>
                    </div>
                  </div>
                )}

                {/* ====== CONTEXT SECTION ====== */}
                {activeSection === 'context' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-2xl font-bold text-stone-900 mb-2" style={serifFont}>What you've built</h3>
                      <p className="text-stone-600 text-sm leading-relaxed">Reference layer. The plain-English summary, your tech stack, file structure.</p>
                    </div>

                    <div className="bg-white border border-stone-200 rounded-lg p-5">
                      <p className="text-xs uppercase tracking-widest text-stone-500 mb-3">In a nutshell</p>
                      <p className="text-stone-700 leading-relaxed" style={serifFont}>
                        {projectData.title} is a web app that reads code from GitHub projects and analyzes them for production readiness, persona-fit, and shipping risks. It produces actionable gap reports with copy-paste prompts for AI coding tools.
                      </p>
                    </div>

                    <div className="bg-white border border-stone-200 rounded-lg p-5">
                      <p className="text-xs uppercase tracking-widest text-stone-500 mb-3">Tech stack</p>
                      <div className="space-y-2 text-sm">
                        {Object.entries(projectData.stack).map(([k, v]) => (
                          <div key={k} className="flex justify-between">
                            <span className="text-stone-500 capitalize">{k}</span>
                            <span className="font-medium text-stone-900">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* SIDEBAR */}
              <div className="space-y-5">
                <div className="bg-white border border-stone-200 rounded-lg p-5">
                  <p className="text-xs uppercase tracking-widest text-stone-500 mb-3">Stack</p>
                  <div className="space-y-2">
                    {Object.entries(projectData.stack).slice(0, 4).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <span className="text-stone-500 capitalize text-xs">{k}</span>
                        <span className="font-medium text-stone-900 text-xs text-right">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-stone-200 rounded-lg p-5">
                  <p className="text-xs uppercase tracking-widest text-stone-500 mb-3">Personas</p>
                  <div className="space-y-2.5">
                    {projectData.personas.map(p => (
                      <div key={p.name} className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span>{p.icon}</span>
                          <span className="text-stone-700 truncate">{p.name}</span>
                        </div>
                        <span className="font-medium text-stone-900 flex-shrink-0">{p.readiness}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button onClick={() => setChatOpen(true)} className="w-full bg-stone-900 hover:bg-stone-800 text-white rounded-lg p-5 text-left transition-colors group">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-semibold">Ask Claude</p>
                    <MessageCircle className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <p className="text-xs text-stone-300">Get advice on any gap or priority</p>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {chatOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-stone-900/40 backdrop-blur-sm" onClick={() => setChatOpen(false)} style={sansFont}>
          <div className="w-full max-w-lg bg-white sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh] sm:max-h-[600px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-stone-700" />
                <p className="font-semibold text-stone-900">Ask Claude</p>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-stone-500 hover:text-stone-900 text-sm">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-stone-900 text-white rounded-br-sm' : 'bg-stone-100 text-stone-900 rounded-bl-sm'}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {['priorities', 'how does verification work', 'partial commits', 'reject reasons'].map(prompt => (
                <button key={prompt} onClick={() => sendChatMessage(prompt)} className="text-xs px-3 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-full transition-colors">
                  {prompt}
                </button>
              ))}
            </div>
            <div className="p-3 border-t border-stone-200 flex gap-2">
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()} placeholder="Ask anything..." className="flex-1 px-3 py-2 border border-stone-300 rounded-md text-sm focus:outline-none focus:border-stone-900" />
              <button onClick={() => sendChatMessage()} className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-md text-sm font-medium">Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
