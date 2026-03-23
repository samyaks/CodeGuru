import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, CheckCircle2, XCircle, Loader, GitPullRequest,
  FolderGit2, Search, Star, Lock, GitFork, ChevronRight,
  ArrowLeft, ExternalLink, Play,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import SeverityBadge from '../components/SeverityBadge';
import {
  createReview, fetchReviews, fetchGitHubRepos, fetchRepoPulls,
  Review, GitHubRepo, GitHubPR, parseReport,
} from '../services/api';

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Clock size={14} />,
  in_progress: <Loader size={14} className="spinner" />,
  completed: <CheckCircle2 size={14} />,
  failed: <XCircle size={14} />,
};

type View = 'repos' | 'pulls';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [view, setView] = useState<View>('repos');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);

  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [pulls, setPulls] = useState<GitHubPR[]>([]);
  const [pullsLoading, setPullsLoading] = useState(false);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [manualUrl, setManualUrl] = useState('');
  const [manualType, setManualType] = useState<'pr' | 'repo'>('pr');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Load repos
  useEffect(() => {
    const githubUsername = user?.user_name;
    if (!debouncedSearch && !githubUsername) return;

    setReposLoading(true);
    setError(null);

    const params = debouncedSearch
      ? { search: debouncedSearch }
      : { username: githubUsername! };

    fetchGitHubRepos(params)
      .then((data) => setRepos(data.repos))
      .catch((e) => setError(e.message))
      .finally(() => setReposLoading(false));
  }, [debouncedSearch, user?.user_name]);

  // Load recent reviews
  useEffect(() => {
    setReviewsLoading(true);
    fetchReviews()
      .then(setReviews)
      .catch(() => {})
      .finally(() => setReviewsLoading(false));
  }, []);

  const openRepo = useCallback((repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setView('pulls');
    setPullsLoading(true);
    fetchRepoPulls(repo.owner, repo.name)
      .then((data) => setPulls(data.pulls))
      .catch((e) => setError(e.message))
      .finally(() => setPullsLoading(false));
  }, []);

  const backToRepos = useCallback(() => {
    setView('repos');
    setSelectedRepo(null);
    setPulls([]);
  }, []);

  const startReview = useCallback(async (repoUrl: string, type: 'pr' | 'repo', key: string) => {
    setSubmitting(key);
    setError(null);
    try {
      const { reviewId } = await createReview({ repoUrl, type });
      navigate(`/review/${reviewId}/progress`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(null);
    }
  }, [navigate]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualUrl.trim()) return;
    startReview(manualUrl.trim(), manualType, 'manual');
  };

  const getHighestSeverity = (review: Review): string | null => {
    const report = parseReport(review.ai_report);
    if (!report?.stats) return null;
    if (report.stats.critical > 0) return 'critical';
    if (report.stats.warnings > 0) return 'warning';
    if (report.stats.info > 0) return 'info';
    return 'ok';
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <div className="dashboard">
      <div className="dashboard-hero">
        <h1>Code Reviewer</h1>
        <p>AI-powered first-pass code review. Pick a repo or PR to analyze.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* ===== Repo / PR Browser ===== */}
      <div className="browser-section">
        {view === 'repos' && (
          <>
            <div className="browser-header">
              <h2><FolderGit2 size={18} /> Your Repositories</h2>
            </div>
            <div className="browser-search">
              <Search size={16} className="input-icon" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search GitHub repositories..."
              />
            </div>

            {reposLoading && (
              <div className="loading-text"><Loader size={16} className="spinner" /> Loading repos...</div>
            )}

            {!reposLoading && repos.length === 0 && !debouncedSearch && (
              <div className="empty-state">
                {user?.user_name
                  ? 'Loading your repositories...'
                  : 'Search for a repository above to get started.'}
              </div>
            )}

            {!reposLoading && repos.length === 0 && debouncedSearch && (
              <div className="empty-state">No repositories found for "{debouncedSearch}"</div>
            )}

            <div className="repo-list">
              {repos.map((repo) => (
                <div key={repo.full_name} className="repo-card" onClick={() => openRepo(repo)}>
                  <div className="repo-card-main">
                    <div className="repo-card-name">
                      {repo.private && <Lock size={13} />}
                      <span>{repo.full_name}</span>
                    </div>
                    {repo.description && (
                      <div className="repo-card-desc">{repo.description}</div>
                    )}
                    <div className="repo-card-meta">
                      {repo.language && <span className="repo-lang">{repo.language}</span>}
                      <span className="repo-stat"><Star size={12} /> {repo.stargazers_count}</span>
                      <span className="repo-stat"><GitFork size={12} /> {repo.forks_count}</span>
                      <span className="repo-stat">Updated {timeAgo(repo.updated_at)}</span>
                    </div>
                  </div>
                  <div className="repo-card-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        startReview(repo.html_url, 'repo', `repo-${repo.full_name}`);
                      }}
                      disabled={submitting === `repo-${repo.full_name}`}
                    >
                      {submitting === `repo-${repo.full_name}` ? <Loader size={12} className="spinner" /> : <Play size={12} />}
                      Review
                    </button>
                    <ChevronRight size={16} className="repo-card-chevron" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {view === 'pulls' && selectedRepo && (
          <>
            <div className="browser-header">
              <button className="btn btn-ghost" onClick={backToRepos}>
                <ArrowLeft size={16} /> Back
              </button>
              <h2>
                <GitPullRequest size={18} /> {selectedRepo.full_name}
                <a href={selectedRepo.html_url} target="_blank" rel="noopener noreferrer" className="ext-link">
                  <ExternalLink size={14} />
                </a>
              </h2>
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => startReview(selectedRepo.html_url, 'repo', `repo-full-${selectedRepo.full_name}`)}
                disabled={submitting === `repo-full-${selectedRepo.full_name}`}
              >
                {submitting === `repo-full-${selectedRepo.full_name}` ? <Loader size={12} className="spinner" /> : <FolderGit2 size={14} />}
                Review Entire Repo
              </button>
            </div>

            {pullsLoading && (
              <div className="loading-text"><Loader size={16} className="spinner" /> Loading pull requests...</div>
            )}

            {!pullsLoading && pulls.length === 0 && (
              <div className="empty-state">No open pull requests. You can still review the entire repository above.</div>
            )}

            <div className="pr-list">
              {pulls.map((pr) => (
                <div key={pr.number} className="pr-card">
                  <div className="pr-card-main">
                    <div className="pr-card-title">
                      <span className="pr-number">#{pr.number}</span>
                      <span>{pr.title}</span>
                      {pr.draft && <span className="pr-draft-badge">Draft</span>}
                    </div>
                    <div className="pr-card-meta">
                      <img src={pr.user_avatar} alt="" className="pr-avatar" />
                      <span>{pr.user}</span>
                      <span className="pr-branches">{pr.head_branch} → {pr.base_branch}</span>
                      <span>{timeAgo(pr.updated_at)}</span>
                    </div>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      startReview(pr.html_url, 'pr', `pr-${pr.number}`)
                    }
                    disabled={submitting === `pr-${pr.number}`}
                  >
                    {submitting === `pr-${pr.number}` ? <Loader size={12} className="spinner" /> : <Play size={12} />}
                    Review PR
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ===== Manual URL Fallback ===== */}
      <div className="manual-section">
        <div className="manual-divider">
          <span>or enter a URL directly</span>
        </div>
        <form onSubmit={handleManualSubmit} className="review-form">
          <div className="review-form-type">
            <button
              type="button"
              className={`type-btn ${manualType === 'pr' ? 'active' : ''}`}
              onClick={() => setManualType('pr')}
            >
              <GitPullRequest size={16} /> PR
            </button>
            <button
              type="button"
              className={`type-btn ${manualType === 'repo' ? 'active' : ''}`}
              onClick={() => setManualType('repo')}
            >
              <FolderGit2 size={16} /> Repo
            </button>
          </div>
          <div className="review-form-input">
            <Search size={18} className="input-icon" />
            <input
              type="text"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder={manualType === 'pr' ? 'https://github.com/owner/repo/pull/123' : 'https://github.com/owner/repo'}
              disabled={submitting === 'manual'}
            />
            <button type="submit" className="btn btn-primary" disabled={submitting === 'manual' || !manualUrl.trim()}>
              {submitting === 'manual' ? 'Starting...' : 'Start Review'}
            </button>
          </div>
        </form>
      </div>

      {/* ===== Recent Reviews ===== */}
      <div className="dashboard-reviews">
        <h2>Recent Reviews</h2>
        {reviewsLoading && <div className="loading-text"><Loader size={16} className="spinner" /> Loading reviews...</div>}
        {!reviewsLoading && reviews.length === 0 && (
          <div className="empty-state">No reviews yet. Pick a repo or PR above to get started.</div>
        )}
        {reviews.map((r) => {
          const severity = r.status === 'completed' ? getHighestSeverity(r) : null;
          return (
            <div
              key={r.id}
              className={`review-row review-row-${r.status}`}
              onClick={() => navigate(r.status === 'completed' || r.status === 'failed' ? `/review/${r.id}` : `/review/${r.id}/progress`)}
            >
              <div className="review-row-icon">
                {r.type === 'pr' ? <GitPullRequest size={18} /> : <FolderGit2 size={18} />}
              </div>
              <div className="review-row-info">
                <div className="review-row-title">
                  {r.owner}/{r.repo}
                  {r.pr_number && <span className="review-row-pr">#{r.pr_number}</span>}
                </div>
                <div className="review-row-meta">
                  <span className={`status-label status-${r.status}`}>
                    {statusIcons[r.status]} {r.status.replace('_', ' ')}
                  </span>
                  <span className="review-row-time">{new Date(r.created_at).toLocaleString()}</span>
                </div>
              </div>
              <div className="review-row-severity">
                {severity && <SeverityBadge severity={severity} size="sm" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
