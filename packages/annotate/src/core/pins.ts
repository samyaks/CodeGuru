import type { Pin, Reply, ElementContext } from "./types";
import { generateId } from "./utils";

export function createPin(
  x: number,
  y: number,
  text: string,
  author: string,
  elementContext: ElementContext | null,
): Pin {
  return {
    id: generateId(),
    x,
    y,
    text,
    author,
    timestamp: Date.now(),
    elementContext,
    replies: [],
    resolved: false,
  };
}

export function addReply(pin: Pin, text: string, author: string): Pin {
  const reply: Reply = { author, text, timestamp: Date.now() };
  return { ...pin, replies: [...pin.replies, reply] };
}

export function resolvePin(pin: Pin): Pin {
  return { ...pin, resolved: true };
}

export function reopenPin(pin: Pin): Pin {
  return { ...pin, resolved: false };
}

export function deletePin(pins: Pin[], pinId: string): Pin[] {
  return pins.filter((p) => p.id !== pinId);
}
