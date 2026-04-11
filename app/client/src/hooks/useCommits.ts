import { useState, useEffect, useCallback } from 'react';

export interface GitCommit {
  sha: string;
  shortSha: string;
  title: string;
  message: string;
  author: string;
  authorLogin: string | null;
  authorAvatar: string | null;
  date: string;
  url: string;
  filesChanged?: Array<{ path: string; status: string; additions: number; deletions: number }>;
}

export function useCommits(projectId: string) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetch(`/api/projects/${projectId}/commits`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setCommits(data.commits || []);
        setReason(data.reason || null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const loadCommitDetail = useCallback(async (sha: string) => {
    const res = await fetch(`/api/projects/${projectId}/commits/${sha}`, {
      credentials: 'include',
    });
    const data = await res.json();
    setCommits((prev) =>
      prev.map((c) => (c.sha === sha ? { ...c, filesChanged: data.files } : c))
    );
    return data;
  }, [projectId]);

  return { commits, loading, error, reason, loadCommitDetail };
}
