import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Copy, Check, ThumbsUp, ThumbsDown, Terminal, Code2,
  AlertCircle, AlertTriangle, Info, Loader,
} from 'lucide-react';
import Header from '../components/Header';
import { fetchFixPrompt, postFixEvent, FixPromptFull } from '../services/api';

const severityStyles: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

const severityIcon: Record<string, React.ReactNode> = {
  critical: <AlertCircle size={14} />,
  warning: <AlertTriangle size={14} />,
  info: <Info size={14} />,
};

export default function FixPrompt() {
  const { shortId } = useParams<{ shortId: string }>();
  const [prompt, setPrompt] = useState<FixPromptFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (!shortId) return;
    fetchFixPrompt(shortId)
      .then((data) => {
        setPrompt(data);
        postFixEvent(shortId, 'page_view');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [shortId]);

  const handleCopy = useCallback(async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt.full_prompt);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt.full_prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    postFixEvent(shortId!, 'copy_prompt');
    setTimeout(() => setCopied(false), 2500);
  }, [prompt, shortId]);

  const handleFeedback = useCallback((type: 'up' | 'down') => {
    if (feedback) return;
    setFeedback(type);
    postFixEvent(shortId!, type === 'up' ? 'feedback_up' : 'feedback_down');
  }, [feedback, shortId]);

  const handleDeeplink = useCallback((target: string) => {
    postFixEvent(shortId!, 'deeplink_click', target);
  }, [shortId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-neutral-400">
          <Loader size={18} className="animate-spin" />
          Loading fix prompt…
        </div>
      </div>
    );
  }

  if (error || !prompt) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <AlertCircle size={32} className="mx-auto text-red-400" />
          <h2 className="text-xl font-semibold">Fix prompt not found</h2>
          <p className="text-neutral-400 text-sm max-w-md">
            {error || 'This fix prompt may have expired or the link is invalid.'}
          </p>
        </div>
      </div>
    );
  }

  const isStale = Date.now() - new Date(prompt.created_at).getTime() > 24 * 60 * 60 * 1000;
  const sev = severityStyles[prompt.severity] || severityStyles.info;

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo="/dashboard" title="Fix Prompt" />
      <div className="max-w-3xl w-full mx-auto px-6 py-10 space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${sev}`}>
              {severityIcon[prompt.severity]} {prompt.severity}
            </span>
            <span className="text-xs text-neutral-500 uppercase tracking-wider font-medium">
              {prompt.issue_category}
            </span>
          </div>
          <h1 className="text-2xl font-bold">{prompt.issue_title}</h1>
          <p className="flex items-center gap-1.5 text-sm text-neutral-400 font-mono">
            <Code2 size={14} className="shrink-0" />
            {prompt.file_path}
            {prompt.line_start && (
              <span className="text-neutral-500">
                :{prompt.line_start}{prompt.line_end ? `-${prompt.line_end}` : ''}
              </span>
            )}
          </p>
        </div>

        {prompt.issue_description && (
          <p className="text-sm text-neutral-300 leading-relaxed">{prompt.issue_description}</p>
        )}

        {isStale && (
          <div className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
            This fix prompt was generated over 24 hours ago. Line numbers may have shifted if the PR was updated.
          </div>
        )}

        <button
          onClick={handleCopy}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-sm transition-colors ${
            copied
              ? 'bg-green-600 text-white'
              : 'bg-violet-600 hover:bg-violet-500 text-white'
          }`}
        >
          {copied ? <><Check size={18} /> Copied to clipboard!</> : <><Copy size={18} /> Copy fix prompt to clipboard</>}
        </button>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-neutral-500">Then paste into:</span>
          {[
            { target: 'cursor', label: 'Cursor', icon: <Terminal size={14} /> },
            { target: 'claude_code', label: 'Claude Code', icon: <Terminal size={14} /> },
            { target: 'copilot', label: 'Copilot Chat', icon: <Code2 size={14} /> },
          ].map((dl) => (
            <button
              key={dl.target}
              onClick={() => handleDeeplink(dl.target)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors"
            >
              {dl.icon} {dl.label}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-neutral-800 overflow-hidden">
          <div className="px-4 py-2.5 bg-neutral-800/60 border-b border-neutral-800 text-xs font-medium text-neutral-400">
            Fix Prompt
          </div>
          <pre className="p-4 text-sm text-neutral-300 whitespace-pre-wrap break-words leading-relaxed overflow-x-auto">
            {prompt.full_prompt}
          </pre>
        </div>

        {prompt.related_files.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-neutral-300">Related Files</h3>
            <div className="space-y-1.5">
              {prompt.related_files.map((rf, i) => (
                <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-sm">
                  <code className="text-violet-400 shrink-0">{rf.path}</code>
                  <span className="text-neutral-500">{rf.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <span className="text-sm text-neutral-400">Was this helpful?</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleFeedback('up')}
              disabled={feedback !== null}
              className={`p-2 rounded-lg border transition-colors ${
                feedback === 'up'
                  ? 'bg-green-500/15 border-green-500/30 text-green-400'
                  : 'border-neutral-700 text-neutral-500 hover:text-white hover:border-neutral-600 disabled:opacity-40'
              }`}
            >
              <ThumbsUp size={16} />
            </button>
            <button
              onClick={() => handleFeedback('down')}
              disabled={feedback !== null}
              className={`p-2 rounded-lg border transition-colors ${
                feedback === 'down'
                  ? 'bg-red-500/15 border-red-500/30 text-red-400'
                  : 'border-neutral-700 text-neutral-500 hover:text-white hover:border-neutral-600 disabled:opacity-40'
              }`}
            >
              <ThumbsDown size={16} />
            </button>
          </div>
          {feedback && <span className="text-xs text-neutral-500">Thanks for the feedback!</span>}
        </div>

        <div className="pt-4 border-t border-neutral-800/50 text-center text-xs text-neutral-600">
          Powered by <strong className="text-neutral-500">CodeGuru</strong> &middot;
          Expires {new Date(prompt.expires_at).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
