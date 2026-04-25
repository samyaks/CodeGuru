import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Rocket, ExternalLink, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
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
  const urlSynced = messages.find((m) => m.type === 'url-synced') as any;
  const isSyncing = messages.some((m) => m.type === 'progress' && (m as any).phase === 'url-sync') && !urlSynced;
  const latestProgress = [...messages].reverse().find((m) => m.type === 'progress') as any;

  useEffect(() => {
    if (!id || deployStarted) return;
    let cancelled = false;

    fetchProject(id)
      .then((project) => {
        if (cancelled) return;
        if (project.status === 'ready') {
          navigate(`/takeoff/${id}/env-setup`, { replace: true });
          return;
        }
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
      <Header backTo={id ? `/projects/${id}` : '/'} />

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        <div className="max-w-lg w-full text-center space-y-8">
          {deployError && !deployed && !failed ? (
            <div className="space-y-4">
              <AlertCircle size={48} className="text-danger mx-auto" />
              <h2 className="text-xl font-semibold text-text">Deploy Failed to Start</h2>
              <p className="text-sm text-text-muted">{deployError}</p>
              <button
                onClick={() => navigate(`/projects/${id}`)}
                className="px-6 py-2 rounded-lg bg-surface border border-line text-text-soft hover:bg-page transition-colors text-sm"
              >
                Back to Project
              </button>
            </div>
          ) : deployed ? (
            <div className="space-y-6">
              <div className="w-20 h-20 mx-auto rounded-full bg-success-bg border-2 border-success-border flex items-center justify-center">
                <Rocket size={36} className="text-success" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-text">Your app is live!</h2>
                <a
                  href={deployed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-brand hover:underline"
                >
                  {deployed.url} <ExternalLink size={14} />
                </a>
              </div>
              <div className="flex gap-3 justify-center">
                <a
                  href={deployed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-2.5 rounded-lg bg-brand text-white font-medium hover:bg-brand-hov transition-colors text-sm"
                >
                  Visit Your App
                </a>
                <button
                  onClick={() => navigate('/dashboard')}
                  className="px-6 py-2.5 rounded-lg bg-surface border border-line text-text-soft hover:bg-page transition-colors text-sm"
                >
                  Dashboard
                </button>
              </div>

              {(isSyncing || urlSynced) && (
                <div className="mt-6 text-left glass rounded-lg p-4 border border-divider">
                  <h3 className="text-sm font-medium text-text mb-3">URL Sync</h3>
                  {isSyncing && !urlSynced && (
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <Loader2 size={14} className="animate-spin text-brand" />
                      Syncing live URL across services...
                    </div>
                  )}
                  {urlSynced?.results?.map((r: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs py-1">
                      {r.status === 'synced' ? (
                        <CheckCircle2 size={14} className="text-success mt-0.5 shrink-0" />
                      ) : (
                        <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
                      )}
                      <div>
                        <span className="text-text">
                          {r.service === 'railway_env' ? 'Railway env vars' : 'Supabase Auth'}
                        </span>
                        {r.status === 'synced' && r.updated && (
                          <span className="text-text-muted ml-1">
                            ({r.updated.join(', ')})
                          </span>
                        )}
                        {r.status === 'failed' && (
                          <span className="text-warning ml-1">{r.error}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : failed ? (
            <div className="space-y-6">
              <AlertCircle size={48} className="text-danger mx-auto" />
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-text">Deploy Failed</h2>
                <p className="text-sm text-text-muted">{(failed as any).error}</p>
              </div>
              {(failed as any).buildLogs && (
                <pre className="text-left text-xs text-text-soft bg-page rounded-lg p-4 overflow-auto max-h-64 border border-divider">
                  {(failed as any).buildLogs}
                </pre>
              )}
              <button
                onClick={() => navigate(`/projects/${id}`)}
                className="px-6 py-2 rounded-lg bg-surface border border-line text-text-soft hover:bg-page transition-colors text-sm"
              >
                Back to Project
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <Loader2 className="w-16 h-16 text-brand animate-spin mx-auto" />
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-text">Deploying your app</h2>
                <p className="text-text-muted text-sm">
                  {latestProgress?.message || 'Starting deployment...'}
                </p>
              </div>
              <div className="flex flex-col gap-1 text-left max-w-sm mx-auto">
                {messages
                  .filter((m) => m.type === 'progress')
                  .slice(-5)
                  .map((m, i) => (
                    <div key={i} className="text-xs text-text-muted truncate">
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
