import React, { useState } from "react";
import { useAnnotate } from "./AnnotateContext";

const MODE_BUTTONS = [
  { key: "clean" as const, label: "Clean", icon: "◯" },
  { key: "review" as const, label: "Review", icon: "◉" },
  { key: "annotate" as const, label: "Annotate", icon: "✎" },
];

function getActiveButtonStyle(key: string) {
  if (key === "annotate") return { background: "rgba(244,63,94,.18)", color: "#f43f5e" };
  if (key === "review") return { background: "rgba(99,102,241,.15)", color: "#818cf8" };
  return { background: "rgba(255,255,255,.06)", color: "#dcdce6" };
}

export default function FloatingPill() {
  const { mode, setMode, panelOpen, setPanelOpen, session, config } = useAnnotate();
  const [expanded, setExpanded] = useState(false);

  const isRight = config.position !== "bottom-left";
  const positionStyle = isRight ? { right: 16 } : { left: 16 };
  const openCount = session.pins.filter((p) => !p.resolved).length;

  // Collapsed dot until the user explicitly opens it
  if (!expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = "1";
          e.currentTarget.style.transform = "scale(1.12)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = "0.45";
          e.currentTarget.style.transform = "scale(1)";
        }}
        style={{
          position: "fixed",
          bottom: 16,
          ...positionStyle,
          zIndex: 10010,
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: "rgba(24,24,37,.7)",
          border: "1px solid rgba(255,255,255,.06)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          opacity: 0.45,
          transition: "all .2s",
        }}
      >
        <div
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#f43f5e,#e11d48)",
          }}
        />
      </div>
    );
  }

  // Expanded pill
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        ...positionStyle,
        zIndex: 10010,
        animation: "bIn .2s cubic-bezier(.34,1.56,.64,1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(24,24,37,.92)",
          border: "1px solid rgba(255,255,255,.08)",
          backdropFilter: "blur(12px)",
          borderRadius: 28,
          padding: "4px 5px",
          boxShadow: "0 8px 32px rgba(0,0,0,.4)",
          gap: 3,
        }}
      >
        {/* T logo */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#f43f5e,#e11d48)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 800,
            color: "#fff",
            fontFamily: "'DM Mono',monospace",
            flexShrink: 0,
          }}
        >
          T
        </div>

        {/* Mode buttons */}
        {MODE_BUTTONS.map((m) => {
          const isActive = mode === m.key;
          const activeStyle = isActive
            ? getActiveButtonStyle(m.key)
            : { background: "transparent", color: "#5a5a6e" };

          return (
            <button
              key={m.key}
              onClick={() => {
                setMode(m.key);
                if (m.key === "clean") {
                  setExpanded(false);
                  setPanelOpen(false);
                }
              }}
              style={{
                ...activeStyle,
                border: "none",
                borderRadius: 20,
                padding: "5px 11px",
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif",
                transition: "all .15s",
                display: "flex",
                alignItems: "center",
                gap: 4,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontSize: 9 }}>{m.icon}</span>
              {m.label}
            </button>
          );
        })}

        {/* Divider + panel toggle (only when not clean) */}
        {mode !== "clean" && (
          <>
            <div
              style={{
                width: 1,
                height: 18,
                background: "rgba(255,255,255,.07)",
                margin: "0 2px",
              }}
            />
            <button
              onClick={() => setPanelOpen(!panelOpen)}
              style={{
                background: "rgba(255,255,255,.04)",
                border: "none",
                borderRadius: 20,
                padding: "5px 9px",
                color: "#8a8a9c",
                fontSize: 11,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              💬
              {openCount > 0 && (
                <span
                  style={{
                    background: "#f43f5e",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "0 5px",
                    fontSize: 9,
                    fontWeight: 700,
                    lineHeight: "15px",
                    minWidth: 15,
                    textAlign: "center",
                  }}
                >
                  {openCount}
                </span>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
