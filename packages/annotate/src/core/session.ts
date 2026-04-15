import type { Session, Pin, Reply, ElementContext } from "./types";
import { generateId } from "./utils";

const HASH_PREFIX = "#tf=";

// --- Minification helpers ---

interface MinifiedReply {
  a: string;
  t: string;
  s: number;
}

interface MinifiedElement {
  g: string;
  l: string[];
  q: string;
  x: string;
  r: { top: number; left: number; width: number; height: number };
}

interface MinifiedPin {
  i: string;
  x: number;
  y: number;
  t: string;
  a: string;
  s: number;
  e: MinifiedElement | null;
  r: MinifiedReply[];
  d: boolean;
}

interface MinifiedSession {
  i: string;
  n: string;
  c: number;
  p: MinifiedPin[];
}

function minifyElement(el: ElementContext): MinifiedElement {
  return { g: el.tag, l: el.classes, q: el.selector, x: el.textContent, r: el.rect };
}

function expandElement(m: MinifiedElement): ElementContext {
  return {
    tag: m.g,
    classes: m.l,
    selector: m.q,
    textContent: m.x,
    rect: m.r,
  };
}

function minifyReply(r: Reply): MinifiedReply {
  return { a: r.author, t: r.text, s: r.timestamp };
}

function expandReply(m: MinifiedReply): Reply {
  return { author: m.a, text: m.t, timestamp: m.s };
}

function minifyPin(pin: Pin): MinifiedPin {
  return {
    i: pin.id,
    x: pin.x,
    y: pin.y,
    t: pin.text,
    a: pin.author,
    s: pin.timestamp,
    e: pin.elementContext ? minifyElement(pin.elementContext) : null,
    r: pin.replies.map(minifyReply),
    d: pin.resolved,
  };
}

function expandPin(m: MinifiedPin): Pin {
  return {
    id: m.i,
    x: m.x,
    y: m.y,
    text: m.t,
    author: m.a,
    timestamp: m.s,
    elementContext: m.e ? expandElement(m.e) : null,
    replies: m.r.map(expandReply),
    resolved: m.d,
  };
}

function minifySession(session: Session): MinifiedSession {
  return {
    i: session.id,
    n: session.name,
    c: session.created,
    p: session.pins.map(minifyPin),
  };
}

function expandSession(m: MinifiedSession): Session {
  return {
    id: m.i,
    name: m.n,
    created: m.c,
    pins: m.p.map(expandPin),
  };
}

// --- Public API ---

export function createSession(name: string): Session {
  return {
    id: generateId(),
    name,
    created: Date.now(),
    pins: [],
  };
}

export function encodeSession(session: Session): string {
  const minified = minifySession(session);
  const json = JSON.stringify(minified);
  return btoa(encodeURIComponent(json));
}

export function decodeSession(encoded: string): Session | null {
  try {
    const json = decodeURIComponent(atob(encoded));
    const minified: MinifiedSession = JSON.parse(json);
    return expandSession(minified);
  } catch {
    return null;
  }
}

export function mergeSessions(a: Session, b: Session): Session {
  const pinMap = new Map<string, Pin>();

  for (const pin of a.pins) {
    pinMap.set(pin.id, pin);
  }

  for (const pin of b.pins) {
    const existing = pinMap.get(pin.id);
    if (!existing) {
      pinMap.set(pin.id, pin);
      continue;
    }

    const replyKeys = new Set(
      existing.replies.map((r) => `${r.timestamp}|${r.author}|${r.text}`),
    );
    const mergedReplies = [...existing.replies];
    for (const reply of pin.replies) {
      const key = `${reply.timestamp}|${reply.author}|${reply.text}`;
      if (!replyKeys.has(key)) {
        mergedReplies.push(reply);
        replyKeys.add(key);
      }
    }
    mergedReplies.sort((x, y) => x.timestamp - y.timestamp);

    pinMap.set(pin.id, {
      ...existing,
      replies: mergedReplies,
      resolved: existing.resolved || pin.resolved,
    });
  }

  const base = a.created <= b.created ? a : b;

  return {
    id: base.id,
    name: base.name,
    created: base.created,
    pins: Array.from(pinMap.values()),
  };
}

export function readSessionFromURL(): Session | null {
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const encoded = hash.slice(HASH_PREFIX.length);
  return decodeSession(encoded);
}

export function writeSessionToURL(session: Session): void {
  const encoded = encodeSession(session);
  const newHash = `${HASH_PREFIX}${encoded}`;
  history.replaceState(null, "", newHash);
}

export function getShareableURL(session: Session): string {
  const encoded = encodeSession(session);
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}${HASH_PREFIX}${encoded}`;
}
