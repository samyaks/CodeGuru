import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  GitPullRequest,
  FolderGit2,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle,
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
  Loader,
  Shield,
  Star,
  Cloud,
  Box,
  Workflow,
  Server,
  Lightbulb,
} from 'lucide-react';
import { useReview } from '../hooks/useReview';
import { parseReport, updateHumanNotes, fetchFixPromptsByReview, Finding, DeploymentInfo, FixPromptSummary } from '../services/api';
import FileReviewCard from '../components/FileReviewCard';
import HumanNotes from '../components/HumanNotes';

const verdictConfig: Record<string, { label: string; Icon: React.ElementType; className: string }> = {
  approve: { label: 'Approve', Icon: ThumbsUp, className: 'verdict-approve' },
  request_changes: { label: 'Request Changes', Icon: ThumbsDown, className: 'verdict-changes' },
  needs_discussion: { label: 'Needs Discussion', Icon: MessageCircle, className: 'verdict-discuss' },
};

export default function ReviewReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { review, loading, error } = useReview(id || null);
  const [fixPrompts, setFixPrompts] = useState<FixPromptSummary[]>([]);

  useEffect(() => {
    if (review?.status === 'completed' && id) {
      fetchFixPromptsByReview(id).then(setFixPrompts).catch(() => {});
    }
  }, [review?.status, id]);

  if (loading) {
    return (
      <div className="report-page">
        <div className="loading-text"><Loader size={16} className="spinner" /> Loading review...</div>
      </div>
    );
  }

  if (error || !review) {
    return (
      <div className="report-page">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="error-banner">{error || 'Review not found'}</div>
      </div>
    );
  }

  if (review.status === 'failed') {
    return (
      <div className="report-page">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="error-banner">Review failed: {review.error}</div>
      </div>
    );
  }

  const report = parseReport(review.ai_report);
  const files = review.files || [];

  const findingsPerFile = new Map<string, Finding[]>();
  if (report?.findings) {
    for (const f of report.findings) {
      const key = f.file || 'general';
      if (!findingsPerFile.has(key)) findingsPerFile.set(key, []);
      findingsPerFile.get(key)!.push(f);
    }
  }

  const verdict = report?.verdict ? verdictConfig[report.verdict] : null;

  return (
    <div className="report-page">
      <button className="btn btn-ghost" onClick={() => navigate('/')}>
        <ArrowLeft size={16} /> Back
      </button>

      <div className="report-header">
        <div className="report-header-top">
          {review.type === 'pr' ? <GitPullRequest size={28} /> : <FolderGit2 size={28} />}
          <div>
            <h1>
              {review.owner}/{review.repo}
              {review.pr_number && <span className="pr-tag">#{review.pr_number}</span>}
            </h1>
            <p className="report-meta">
              Reviewed {new Date(review.completed_at || review.created_at).toLocaleString()}
            </p>
          </div>
        </div>

        {verdict && (
          <div className={`verdict ${verdict.className}`}>
            <verdict.Icon size={20} />
            <span>{verdict.label}</span>
          </div>
        )}

        {report?.overallHealth && (
          <div className={`health-badge health-${report.overallHealth}`}>
            <Shield size={16} />
            <span>{report.overallHealth.replace('_', ' ')}</span>
          </div>
        )}
      </div>

      {report && (
        <>
          <section className="report-section">
            <h2>Summary</h2>
            <p className="report-summary">{report.summary}</p>
          </section>

          <section className="report-section">
            <h2>Statistics</h2>
            <div className="stats-grid">
              <div className="stat-card stat-total">
                <div className="stat-num">{report.stats.totalFindings}</div>
                <div className="stat-label">Total Findings</div>
              </div>
              <div className="stat-card stat-critical">
                <AlertCircle size={18} />
                <div className="stat-num">{report.stats.critical}</div>
                <div className="stat-label">Critical</div>
              </div>
              <div className="stat-card stat-warning">
                <AlertTriangle size={18} />
                <div className="stat-num">{report.stats.warnings}</div>
                <div className="stat-label">Warnings</div>
              </div>
              <div className="stat-card stat-info">
                <Info size={18} />
                <div className="stat-num">{report.stats.info}</div>
                <div className="stat-label">Info</div>
              </div>
            </div>
          </section>

          {report.strengths && report.strengths.length > 0 && (
            <section className="report-section">
              <h2><Star size={18} /> Strengths</h2>
              <ul className="strengths-list">
                {report.strengths.map((s, i) => (
                  <li key={i}><CheckCircle size={14} /> {s}</li>
                ))}
              </ul>
            </section>
          )}

          {report.deployment && report.deployment.status !== 'not_applicable' && (
            <DeploymentSection deployment={report.deployment} />
          )}

          <section className="report-section">
            <h2>Files ({files.length})</h2>
            <div className="file-cards">
              {files.map((f) => (
                <FileReviewCard
                  key={f.id}
                  file={f}
                  findings={findingsPerFile.get(f.file_path) || []}
                  reviewId={review.id}
                  fixPrompts={fixPrompts.filter((fp) => fp.file_path === f.file_path)}
                />
              ))}
            </div>
          </section>

          {report.recommendations && (
            <section className="report-section">
              <h2>Recommendations</h2>
              <div className="recommendations">
                {report.recommendations.immediate.length > 0 && (
                  <div className="rec-group">
                    <h3>Immediate</h3>
                    <ul>{report.recommendations.immediate.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
                {report.recommendations.shortTerm.length > 0 && (
                  <div className="rec-group">
                    <h3>Short Term</h3>
                    <ul>{report.recommendations.shortTerm.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
                {report.recommendations.longTerm.length > 0 && (
                  <div className="rec-group">
                    <h3>Long Term</h3>
                    <ul>{report.recommendations.longTerm.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      <section className="report-section">
        <h2>Human Review Notes</h2>
        <HumanNotes
          initial={review.human_notes || ''}
          onSave={(text) => updateHumanNotes(review.id, text)}
          placeholder="Add your overall review notes, decisions, and follow-up actions..."
        />
      </section>
    </div>
  );
}

const deployStatusConfig: Record<string, { label: string; className: string }> = {
  deployed: { label: 'Deployed', className: 'deploy-status-deployed' },
  partial: { label: 'Partial Setup', className: 'deploy-status-partial' },
  no_config_found: { label: 'No Config Found', className: 'deploy-status-none' },
};

function DeploymentSection({ deployment }: { deployment: DeploymentInfo }) {
  const status = deployStatusConfig[deployment.status] || deployStatusConfig.no_config_found;

  return (
    <section className="report-section">
      <h2><Cloud size={18} /> Deployment & Infrastructure</h2>
      <div className="deploy-section">
        <div className="deploy-header">
          <span className={`deploy-status-badge ${status.className}`}>{status.label}</span>
          {deployment.platforms.length > 0 && (
            <div className="deploy-platforms">
              {deployment.platforms.map((p, i) => (
                <span key={i} className="deploy-platform-pill">{p}</span>
              ))}
            </div>
          )}
        </div>

        <p className="deploy-summary">{deployment.summary}</p>

        <div className="deploy-details">
          <div className="deploy-detail-row">
            <Workflow size={14} />
            <span className="deploy-detail-label">CI/CD</span>
            <span className="deploy-detail-value">{deployment.cicd}</span>
          </div>
          <div className="deploy-detail-row">
            <Box size={14} />
            <span className="deploy-detail-label">Containerized</span>
            <span className="deploy-detail-value">{deployment.containerized ? 'Yes' : 'No'}</span>
          </div>
          <div className="deploy-detail-row">
            <Server size={14} />
            <span className="deploy-detail-label">Infrastructure as Code</span>
            <span className="deploy-detail-value">{deployment.iac}</span>
          </div>
        </div>

        {deployment.concerns.length > 0 && (
          <div className="deploy-concerns">
            <h4><AlertTriangle size={14} /> Concerns</h4>
            <ul>
              {deployment.concerns.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {deployment.suggestions.length > 0 && (
          <div className="deploy-suggestions">
            <h4><Lightbulb size={14} /> Suggestions</h4>
            <ul>
              {deployment.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
