import { ApiError, handleApiResponse } from '../lib/api-error';

// Ask Takeoff (Milestone 8). /api/projects/:id/ask needs a signed-in member;
// anyone else, and a project Ask isn't on for, gets 404. Threads are private
// to the person who asked. Every text field is plain text: show it as text,
// never as HTML or Markdown.

export type AskView = 'creator' | 'builder';

export interface AskThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type AskSourceKind = 'plan' | 'agreement' | 'decision' | 'pr_check' | 'capability' | 'commit' | 'file' | 'code';

export interface AskSource {
  n: number;
  id: string;
  kind: AskSourceKind | string;
  label: string;
  area?: string | null;
  text?: string | null;
  status?: string | null;
  pr?: number | null;
  sha?: string | null;
  path?: string | null;
  lines?: string | null;
  url?: string | null;
}

export interface AskParagraph {
  text: string;
  refs: number[];
  code_only: boolean;
}

export interface AskMessage {
  id: string;
  role: 'user' | 'assistant';
  status: 'running' | 'done' | 'failed' | string;
  content: string;
  paragraphs: AskParagraph[];
  sources: AskSource[];
  planSilent: boolean;
  notBuilt: boolean;
  suggestedAgreement: string | null;
  didntGetTo: string | null;
  dropped: number;
  createdAt: string;
}

export type AskEvent =
  | { type: 'started'; threadId: string; questionId: string; answerId: string }
  | { type: 'progress'; text: string }
  | { type: 'answer'; threadId: string; message: AskMessage }
  | { type: 'error'; error: string }
  | { type: 'heartbeat' };

/** A refusal before anything was asked: a limit, a budget, or Ask being off. `code` holds the reason. */
export class AskRefused extends ApiError {
  resetsAt: string | null;
  constructor(message: string, status: number, code: string, resetsAt: string | null) {
    super(message, status, code);
    this.name = 'AskRefused';
    this.resetsAt = resetsAt;
  }
}

export type CodeIndexStatus = 'none' | 'building' | 'ready' | 'behind' | 'failed' | 'too_large';

export interface CodeIndex {
  status: CodeIndexStatus;
  working?: boolean;
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/ask`;

export async function fetchAskThreads(projectId: string): Promise<{ threads: AskThreadSummary[]; view: AskView }> {
  return handleApiResponse(await fetch(`${base(projectId)}/threads`, { credentials: 'include' }));
}

export async function fetchAskThread(projectId: string, threadId: string): Promise<{ thread: AskThreadSummary; messages: AskMessage[] }> {
  return handleApiResponse(await fetch(`${base(projectId)}/threads/${encodeURIComponent(threadId)}`, { credentials: 'include' }));
}

export async function deleteAskThread(projectId: string, threadId: string): Promise<void> {
  await handleApiResponse(await fetch(`${base(projectId)}/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE', credentials: 'include' }));
}

export async function fetchCodeIndex(projectId: string): Promise<CodeIndex> {
  return handleApiResponse(await fetch(`/api/projects/${encodeURIComponent(projectId)}/code-index`, { credentials: 'include' }));
}

/** One event from a `data: {...}` block; anything else is skipped. */
function parseBlock(block: string): AskEvent | null {
  const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
  if (!data) return null;
  try {
    const event = JSON.parse(data) as AskEvent;
    return event && typeof event === 'object' && typeof event.type === 'string' ? event : null;
  } catch {
    return null;
  }
}

/**
 * Ask a question, in a new thread or a follow-up in `threadId`. Events arrive
 * through `onEvent` as the answer is worked out. Resolves when the stream
 * ends. Throws AskRefused when the question isn't taken, and ApiError when
 * the stream breaks off (the answer may still finish on the server).
 */
export async function askQuestion(
  projectId: string,
  body: { question: string; threadId?: string },
  onEvent: (event: AskEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(base(projectId), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('text/event-stream') || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: string; reason?: string; code?: string; resetsAt?: string };
    throw new AskRefused(json.error || 'Takeoff couldn’t take this question. Try again.', res.status, json.reason || json.code || 'UNKNOWN', json.resetsAt || null);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let cut = buffer.indexOf('\n\n');
      while (cut !== -1) {
        const event = parseBlock(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        if (event && event.type !== 'heartbeat') {
          if (event.type === 'answer' || event.type === 'error') ended = true;
          onEvent(event);
        }
        cut = buffer.indexOf('\n\n');
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('The connection dropped before the answer arrived.', 0, 'STREAM_BROKEN');
  }
  const last = parseBlock(buffer);
  if (last && last.type !== 'heartbeat') {
    if (last.type === 'answer' || last.type === 'error') ended = true;
    onEvent(last);
  }
  if (!ended) throw new ApiError('The connection dropped before the answer arrived.', 0, 'STREAM_BROKEN');
}
