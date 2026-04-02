import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Github, Sparkles } from 'lucide-react';
import RepoInput from '../components/RepoInput';
import { analyzeRepo } from '../services/api';

const EXAMPLES = [
  { label: 'CodeGuru', url: 'https://github.com/samyaks/CodeGuru' },
  { label: 'Excalidraw', url: 'https://github.com/excalidraw/excalidraw' },
  { label: 'Cal.com', url: 'https://github.com/calcom/cal.com' },
];

export default function Landing() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async (url: string) => {
    setLoading(true);
    setError(null);
    try {
      const { projectId } = await analyzeRepo(url);
      navigate(`/analyze/${projectId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to start analysis');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-800/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center font-bold text-sm">
            C
          </div>
          <span className="font-semibold text-lg">CodeGuru</span>
        </div>
        <nav className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-sm text-neutral-400 hover:text-white transition-colors"
          >
            Dashboard
          </button>
          <a
            href="https://github.com/samyaks/CodeGuru"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-400 hover:text-white transition-colors"
          >
            <Github size={20} />
          </a>
        </nav>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        <div className="max-w-2xl w-full text-center space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium">
              <Sparkles size={12} />
              AI-powered codebase analysis
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
              You built the front end.
              <br />
              <span className="text-violet-400">We'll help you ship the rest.</span>
            </h1>
            <p className="text-lg text-neutral-400 max-w-xl mx-auto">
              Paste a GitHub repo URL and get <code className="text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded text-sm">.context.md</code> files
              that tell AI tools exactly what your app needs — auth, database, deployment, and more.
            </p>
          </div>

          <RepoInput onSubmit={handleAnalyze} loading={loading} />

          {error && (
            <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
              {error}
            </div>
          )}

          <div className="text-sm text-neutral-500">
            Try an example:
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => handleAnalyze(ex.url)}
                disabled={loading}
                className="ml-2 text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors disabled:opacity-50"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </main>

      <footer className="text-center py-6 text-xs text-neutral-600 border-t border-neutral-800/50">
        CodeGuru &middot; Ship faster with AI-grounded context
      </footer>
    </div>
  );
}
