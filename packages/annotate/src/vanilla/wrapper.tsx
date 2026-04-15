import React from "react";
import { createRoot } from "react-dom/client";
import TakeoffAnnotate from "../react/TakeoffAnnotate";
import type { AnnotateMode } from "../core/types";

interface VanillaConfig {
  projectId?: string;
  theme?: "dark" | "light" | "auto";
  mode?: AnnotateMode;
  position?: "bottom-right" | "bottom-left";
}

export function mountAnnotate(config: VanillaConfig = {}): void {
  const host = document.createElement("div");
  host.id = "takeoff-annotate-root";
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = "10000";
  host.style.pointerEvents = "none";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    @keyframes bIn{from{opacity:0;transform:scale(.92) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  `;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  root.render(
    <TakeoffAnnotate
      projectId={config.projectId}
      theme={config.theme}
      defaultMode={config.mode || "clean"}
      position={config.position}
      vanillaHost={host}
    >
      <div style={{ width: "100vw", height: "100vh" }} />
    </TakeoffAnnotate>,
  );
}
