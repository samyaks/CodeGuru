import { mountAnnotate } from "./wrapper";
import type { AnnotateMode } from "../core/types";

const currentScript = document.currentScript as HTMLScriptElement | null;

function init() {
  const script = currentScript;

  const config: {
    projectId?: string;
    theme?: "dark" | "light" | "auto";
    mode?: AnnotateMode;
    position?: "bottom-right" | "bottom-left";
  } = {};

  if (script) {
    const project = script.getAttribute("data-project");
    if (project) config.projectId = project;

    const theme = script.getAttribute("data-theme");
    if (theme === "dark" || theme === "light" || theme === "auto") {
      config.theme = theme;
    }

    const mode = script.getAttribute("data-mode");
    if (mode === "clean" || mode === "review" || mode === "annotate") {
      config.mode = mode;
    }

    const position = script.getAttribute("data-position");
    if (position === "bottom-right" || position === "bottom-left") {
      config.position = position;
    }
  }

  mountAnnotate(config);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
