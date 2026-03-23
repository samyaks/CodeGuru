import React, { useState } from 'react';
import { GitPullRequest, FolderGit2, Search } from 'lucide-react';

interface Props {
  onSubmit: (params: { repoUrl: string; type: 'pr' | 'repo' }) => void;
  loading?: boolean;
}

export default function ReviewForm({ onSubmit, loading }: Props) {
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'pr' | 'repo'>('pr');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit({ repoUrl: url.trim(), type });
  };

  return (
    <form onSubmit={handleSubmit} className="review-form">
      <div className="review-form-type">
        <button
          type="button"
          className={`type-btn ${type === 'pr' ? 'active' : ''}`}
          onClick={() => setType('pr')}
        >
          <GitPullRequest size={16} />
          PR Review
        </button>
        <button
          type="button"
          className={`type-btn ${type === 'repo' ? 'active' : ''}`}
          onClick={() => setType('repo')}
        >
          <FolderGit2 size={16} />
          Repo Review
        </button>
      </div>

      <div className="review-form-input">
        <Search size={18} className="input-icon" />
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={type === 'pr' ? 'https://github.com/owner/repo/pull/123' : 'https://github.com/owner/repo'}
          disabled={loading}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !url.trim()}>
          {loading ? 'Starting...' : 'Start Review'}
        </button>
      </div>
    </form>
  );
}
