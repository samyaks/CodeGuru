import { useEffect, useRef, useState, useCallback } from 'react';

export interface SSEEvent {
  type: string;
  phase?: string;
  message?: string;
  partial?: string;
  chunks?: number;
  fileCount?: number;
  reviewId?: string;
  error?: string;
  report?: unknown;
}

export function useSSE(reviewId: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<SSEEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!reviewId) return;

    const es = new EventSource(`/api/reviews/${reviewId}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data: SSEEvent = JSON.parse(e.data);
        setLatestEvent(data);
        setEvents((prev) => [...prev, data]);

        if (data.type === 'connected') {
          setConnected(true);
        }
        if (data.type === 'review-completed' || data.type === 'review-error') {
          es.close();
          esRef.current = null;
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [reviewId]);

  return { events, latestEvent, connected, disconnect };
}
