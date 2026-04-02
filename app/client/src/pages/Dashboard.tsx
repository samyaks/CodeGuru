import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FolderGit2, FileText, Loader, ExternalLink } from 'lucide-react';
import { fetchAnalyses, fetchReviews } from '../services/api';

interface Analysis {
  id: string;
  repo_url: string;
  owner: string;
  repo: string;
  status: string;
  completion_pct: number;
  created_at: string;
}

interface Review {
  id: string;
  type: string;
  repo_url: string;
  owner: string;
  repo: string;
  pr_number: number | null;
  status: string;
  created_at: string;
}

export default function Dashboard() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'analyses' | 'reviews'>('analyses');

  useEffect(() => {
    Promise.all([
      fetchAnalyses().catch(() => []),
      fetchReviews().catch(() => []),
    ]).then(([a, r]) => {
      setAnalyses(a);
      setReviews(r);
      setLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-neutral-800/50">
        <Link to="/" className="text-neutral-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-semibold">Dashboard</h1>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex gap-1 mb-6 bg-neutral-900/50 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab('analyses')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'analyses' ? 'bg-violet-600 text-white' : 'text-neutral-400 hover:text-white'
            }`}
          >
            Analyses
          </button>
          <button
            onClick={() => setTab('reviews')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'reviews' ? 'bg-violet-600 text-white' : 'text-neutral-400 hover:text-white'
            }`}
          >
            Reviews
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-24">
            <Loader size={32} className="animate-spin text-violet-400" />
          </div>
        )}

        {!loading && tab === 'analyses' && analyses.length === 0 && (
          <EmptyState icon={<FolderGit2 size={48} />} title="No analyses yet" />
        )}

        {!loading && tab === 'analyses' && analyses.length > 0 && (
          <div className="space-y-3">
            {analyses.map((a) => (
              <Link
                key={a.id}
                to={a.status === 'completed' ? `/results/${a.id}` : `/analyze/${a.id}`}
                className="block bg-neutral-900/50 border border-neutral-800/50 rounded-xl px-5 py-4 hover:border-violet-500/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{a.owner}/{a.repo}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {new Date(a.created_at).toLocaleDateString()} · {a.status}
                    </p>
                  </div>
                  {a.completion_pct != null && (
                    <span className="text-sm font-semibold text-violet-400">{a.completion_pct}%</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {!loading && tab === 'reviews' && reviews.length === 0 && (
          <EmptyState icon={<FileText size={48} />} title="No reviews yet" />
        )}

        {!loading && tab === 'reviews' && reviews.length > 0 && (
          <div className="space-y-3">
            {reviews.map((r) => (
              <Link
                key={r.id}
                to={r.status === 'completed' ? `/review/${r.id}` : `/review/${r.id}/progress`}
                className="block bg-neutral-900/50 border border-neutral-800/50 rounded-xl px-5 py-4 hover:border-violet-500/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {r.owner}/{r.repo}
                      {r.pr_number && <span className="text-neutral-500"> #{r.pr_number}</span>}
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {r.type} review · {new Date(r.created_at).toLocaleDateString()} · {r.status}
                    </p>
                  </div>
                  <ExternalLink size={16} className="text-neutral-600" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
      <div className="text-neutral-600">{icon}</div>
      <h2 className="text-xl font-semibold text-neutral-300">{title}</h2>
      <p className="text-neutral-500 max-w-md">
        Analyze a GitHub repo to see your projects here.
      </p>
      <Link
        to="/"
        className="mt-4 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
      >
        Analyze a repo
      </Link>
    </div>
  );
}
