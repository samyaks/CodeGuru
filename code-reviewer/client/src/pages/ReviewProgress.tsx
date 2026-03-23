import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, GitPullRequest, FolderGit2 } from 'lucide-react';
import StreamingOutput from '../components/StreamingOutput';
import { useSSE } from '../hooks/useSSE';
import { useReview } from '../hooks/useReview';

export default function ReviewProgress() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { review, reload } = useReview(id || null);
  const { events, latestEvent } = useSSE(id || null);

  useEffect(() => {
    if (latestEvent?.type === 'review-completed') {
      setTimeout(() => {
        reload();
        navigate(`/review/${id}`, { replace: true });
      }, 1500);
    }
    if (latestEvent?.type === 'review-error') {
      reload();
    }
  }, [latestEvent, id, navigate, reload]);

  useEffect(() => {
    if (review?.status === 'completed') {
      navigate(`/review/${id}`, { replace: true });
    }
  }, [review, id, navigate]);

  return (
    <div className="progress-page">
      <button className="btn btn-ghost" onClick={() => navigate('/')}>
        <ArrowLeft size={16} /> Back
      </button>

      <div className="progress-header">
        {review?.type === 'pr' ? <GitPullRequest size={24} /> : <FolderGit2 size={24} />}
        <div>
          <h1>
            {review ? `${review.owner}/${review.repo}` : 'Loading...'}
            {review?.pr_number && <span className="pr-tag">#{review.pr_number}</span>}
          </h1>
          <p className="progress-subtitle">Review in progress...</p>
        </div>
      </div>

      <div className="progress-body">
        <StreamingOutput events={events} latestEvent={latestEvent} />

        {latestEvent?.type === 'review-error' && (
          <div className="error-banner">
            Review failed: {latestEvent.error}
          </div>
        )}

        {latestEvent?.type === 'review-completed' && (
          <div className="success-banner">
            Review complete! Redirecting to report...
          </div>
        )}
      </div>
    </div>
  );
}
