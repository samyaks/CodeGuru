import { useState, useEffect, useCallback, useRef } from 'react';
import type { SSEMessage } from '../types/sse';

export function useSSE(url: string | null) {
  const [messages, setMessages] = useState<SSEMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!url) return;

    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };

    source.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data) as { type: string; [key: string]: unknown };
        if (raw.type !== 'heartbeat') {
          setMessages((prev) => [...prev, raw as SSEMessage]);
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    source.onerror = () => {
      setError('Connection lost');
      setConnected(false);
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [url]);

  const close = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setConnected(false);
  }, []);

  return { messages, connected, error, close };
}
