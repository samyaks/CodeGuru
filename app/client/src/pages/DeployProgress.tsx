import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Rocket, ExternalLink, AlertCircle } from 'lucide-react';
import Header from '../components/Header';
import { useSSE } from '../hooks/useSSE';
import { triggerDeploy, fetchProject } from '../services/api';

const ALREADY_ACTIVE = new Set(['deploying', 'building', 'live', 'failed']);

export default function DeployProgress() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [deployStarted, setDeployStarted] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const { messages } = useSSE(deployStarted && id ? `/api/deploy/${id}/stream` : null);

  const deployed = messages.find((m) => m.type === 'deployed') as any;
  const failed = messages.find((m) => m.type === 'failed') as any;
  const latestProgress = [...messages].reverse().find((m) => m.type === 'progress') as any;

  useEffect(() => {
    if (!id || deployStarted) return;
    let cancelled = false;

    fetchProject(id)
      .then((project) => {
        if (cancelled) return;
        if (ALREADY_ACTIVE.has(project.status)) {
          setDeployStarted(true);
        } else {
          setDeployStarted(true);
          triggerDeploy(id).catch((err) => {
            if (!cancelled) setDeployError(err.message);
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setDeployError(err.message);
      });

    return () => { cancelled = true; };
  }, [id, deployStarted]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo={id ? `/takeoff/${id}/report` : '/'} />

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        <div className="max-w-lg w-full text-center space-y-8">
          {deployError && !deployed && !failed ? (
            <div className="space-y-4">
              <AlertCircle size={48} className="text-red-400 mx-auto" />
              <h2 className="text-xl font-semibold text-sky-white">Deploy Failed to Start</h2>
              <p className="text-sm text-sky-muted">{deployError}</p>
              <button
                onClick={() => navigate(`/takeoff/${id}/report`)}
                className="px-6 py-2 rounded-lg bg-navy border border-sky-border text-sky-off hover:bg-navy-mid transition-colors text-sm"
              >
                Back to Report
              </button>
            </div>
          ) : deployed ? (
            <div className="space-y-6">
              <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center">
                <Rocket size={36} className="text-emerald-400" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-sky-white">Your app is live!</h2>
                <a
                  href={deployed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-gold hover:underline"
                >
                  {deployed.url} <ExternalLink size={14} />
                </a>
              </div>
              <div className="flex gap-3 justify-center">
                <a
                  href={deployed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-2.5 rounded-lg bg-gold text-midnight font-medium hover:bg-gold-dim transition-colors text-sm"
                >
                  Visit Your App
                </a>
                <button
                  onClick={() => navigate('/dashboard')}
                  className="px-6 py-2.5 rounded-lg bg-navy border border-sky-border text-sky-off hover:bg-navy-mid transition-colors text-sm"
                >
                  Dashboard
                </button>
              </div>
            </div>
          ) : failed ? (
            <div className="space-y-6">
              <AlertCircle size={48} className="text-red-400 mx-auto" />
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-sky-white">Deploy Failed</h2>
                <p className="text-sm text-sky-muted">{(failed as any).error}</p>
              </div>
              {(failed as any).buildLogs && (
                <pre className="text-left text-xs text-sky-off bg-midnight rounded-lg p-4 overflow-auto max-h-64 border border-sky-border/30">
                  {(failed as any).buildLogs}
                </pre>
              )}
              <button
                onClick={() => navigate(`/takeoff/${id}/report`)}
                className="px-6 py-2 rounded-lg bg-navy border border-sky-border text-sky-off hover:bg-navy-mid transition-colors text-sm"
              >
                Back to Report
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <Loader2 className="w-16 h-16 text-gold animate-spin mx-auto" />
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-sky-white">Deploying your app</h2>
                <p className="text-sky-muted text-sm">
                  {latestProgress?.message || 'Starting deployment...'}
                </p>
              </div>
              <div className="flex flex-col gap-1 text-left max-w-sm mx-auto">
                {messages
                  .filter((m) => m.type === 'progress')
                  .slice(-5)
                  .map((m, i) => (
                    <div key={i} className="text-xs text-sky-muted truncate">
                      {(m as any).message}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
