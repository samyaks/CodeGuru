import type { ElementContext } from "./types";

export function buildSelector(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && current.tagName.toLowerCase() !== "body" && depth < 3) {
    const tag = current.tagName.toLowerCase();
    const firstClass = current.classList.length > 0 ? `.${current.classList[0]}` : "";
    parts.unshift(`${tag}${firstClass}`);
    current = current.parentElement;
    depth++;
  }

  return parts.join(" > ");
}

export function captureElementContext(
  event: MouseEvent,
  surfaceElement: HTMLElement,
): ElementContext | null {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  if (!target || target === surfaceElement) return null;

  const rect = target.getBoundingClientRect();

  return {
    tag: target.tagName.toLowerCase(),
    classes: Array.from(target.classList).slice(0, 5),
    selector: buildSelector(target),
    textContent: (target.textContent || "").trim().slice(0, 50),
    rect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
  };
}
