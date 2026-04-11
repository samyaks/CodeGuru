import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Copy, Check, ThumbsUp, ThumbsDown, Terminal, Code2,
  AlertCircle, AlertTriangle, Info, Loader,
} from 'lucide-react';
import { fetchFixPrompt, postFixEvent, FixPromptFull } from '../services/api';

const severityIcon: Record<string, React.ReactNode> = {
  critical: <AlertCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />,
};

export default function FixPromptPage() {
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
      setCopied(true);
      postFixEvent(shortId!, 'copy_prompt');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = prompt.full_prompt;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
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
      <div className="app">
        <div className="fix-page">
          <div className="loading-text"><Loader size={16} className="spinner" /> Loading fix prompt...</div>
        </div>
      </div>
    );
  }

  if (error || !prompt) {
    return (
      <div className="app">
        <div className="fix-page">
          <div className="fix-page-error">
            <AlertCircle size={24} />
            <h2>Fix prompt not found</h2>
            <p>{error || 'This fix prompt may have expired or the link is invalid.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const isStale = Date.now() - new Date(prompt.created_at).getTime() > 24 * 60 * 60 * 1000;

  return (
    <div className="app">
      <div className="fix-page">
        <div className="fix-page-header">
          <div className="fix-page-title-row">
            <span className={`badge badge-${prompt.severity}`}>
              {severityIcon[prompt.severity]} {prompt.severity}
            </span>
            <span className="fix-page-category">{prompt.issue_category}</span>
          </div>
          <h1>{prompt.issue_title}</h1>
          <p className="fix-page-file">
            <Code2 size={14} />
            {prompt.file_path}
            {prompt.line_start && <span>:{prompt.line_start}{prompt.line_end ? `-${prompt.line_end}` : ''}</span>}
          </p>
        </div>

        {isStale && (
          <div className="fix-stale-warning">
            This fix prompt was generated over 24 hours ago. Line numbers may have shifted if the PR was updated.
          </div>
        )}

        <button
          className={`fix-copy-btn ${copied ? 'fix-copy-btn-copied' : ''}`}
          onClick={handleCopy}
        >
          {copied ? <><Check size={18} /> Copied to clipboard!</> : <><Copy size={18} /> Copy fix prompt to clipboard</>}
        </button>

        <div className="fix-deeplinks">
          <span className="fix-deeplinks-label">Then paste into:</span>
          <button
            className="fix-deeplink-btn"
            onClick={() => handleDeeplink('cursor')}
            title="Open Cursor and paste"
          >
            <Terminal size={14} /> Cursor
          </button>
          <button
            className="fix-deeplink-btn"
            onClick={() => handleDeeplink('claude_code')}
            title="Use with Claude Code"
          >
            <Terminal size={14} /> Claude Code
          </button>
          <button
            className="fix-deeplink-btn"
            onClick={() => handleDeeplink('copilot')}
            title="Paste into Copilot Chat"
          >
            <Code2 size={14} /> Copilot Chat
          </button>
        </div>

        <div className="fix-prompt-display">
          <div className="fix-prompt-display-header">
            <span>Fix Prompt</span>
          </div>
          <pre className="fix-prompt-content">{prompt.full_prompt}</pre>
        </div>

        {prompt.related_files.length > 0 && (
          <div className="fix-related-files">
            <h3>Related Files</h3>
            {prompt.related_files.map((rf, i) => (
              <div key={i} className="fix-related-file">
                <code>{rf.path}</code>
                <span>{rf.reason}</span>
              </div>
            ))}
          </div>
        )}

        <div className="fix-feedback">
          <span className="fix-feedback-label">Was this fix prompt helpful?</span>
          <div className="fix-feedback-buttons">
            <button
              className={`fix-feedback-btn ${feedback === 'up' ? 'fix-feedback-active-up' : ''}`}
              onClick={() => handleFeedback('up')}
              disabled={feedback !== null}
            >
              <ThumbsUp size={16} />
            </button>
            <button
              className={`fix-feedback-btn ${feedback === 'down' ? 'fix-feedback-active-down' : ''}`}
              onClick={() => handleFeedback('down')}
              disabled={feedback !== null}
            >
              <ThumbsDown size={16} />
            </button>
          </div>
          {feedback && <span className="fix-feedback-thanks">Thanks for the feedback!</span>}
        </div>

        <div className="fix-page-footer">
          <p>
            Powered by <strong>CodeGuru</strong> &middot;
            Expires {new Date(prompt.expires_at).toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
}
