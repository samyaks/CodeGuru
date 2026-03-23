import React from 'react';
import { Loader } from 'lucide-react';
import { SSEEvent } from '../hooks/useSSE';

interface Props {
  events: SSEEvent[];
  latestEvent: SSEEvent | null;
}

export default function StreamingOutput({ events, latestEvent }: Props) {
  const phases = events.filter((e) => e.type === 'progress');
  const hasPartial = latestEvent?.partial;

  return (
    <div className="streaming-output">
      <div className="streaming-phases">
        {phases.map((e, i) => (
          <div key={i} className="streaming-phase">
            <span className="phase-dot" data-phase={e.phase} />
            <span>{e.message}</span>
          </div>
        ))}
        {latestEvent && latestEvent.type !== 'review-completed' && latestEvent.type !== 'review-error' && (
          <div className="streaming-phase active">
            <Loader size={14} className="spinner" />
            <span>Processing...</span>
          </div>
        )}
      </div>

      {hasPartial && (
        <div className="streaming-partial">
          <div className="streaming-partial-label">AI Output (streaming)</div>
          <pre className="streaming-partial-content">{latestEvent!.partial}</pre>
        </div>
      )}
    </div>
  );
}
