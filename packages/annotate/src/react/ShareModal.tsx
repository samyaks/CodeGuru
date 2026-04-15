import { useState } from "react";
import { getShareableURL } from "../core/session";
import { useAnnotate } from "./AnnotateContext";

export interface ShareModalProps {
  onClose: () => void;
}

const SHARING_STEPS = [
  "Your teammate opens the link → sees all existing pins",
  "They switch to Annotate → add their own feedback",
  "They click Share → get an updated URL with their additions",
  "Collect all URLs to see everyone's feedback combined",
];

export function ShareModal({ onClose }: ShareModalProps) {
  const { session, config } = useAnnotate();
  const url = getShareableURL(session);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    config.onShare?.(url);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,.55)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#181825",
          border: "1px solid rgba(255,255,255,.08)",
          borderRadius: 14,
          padding: "24px 28px",
          width: 400,
          boxShadow: "0 24px 64px rgba(0,0,0,.6)",
          animation: "bIn .2s cubic-bezier(.34,1.56,.64,1)",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#dcdce6" }}>
              Share &ldquo;{session.name}&rdquo;
            </div>
            <div style={{ fontSize: 11, color: "#5a5a6e", marginTop: 2 }}>
              Anyone with this link can view and add feedback
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#4a4a60",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>

        {/* URL display */}
        <div
          style={{
            background: "rgba(0,0,0,.2)",
            border: "1px solid rgba(255,255,255,.06)",
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              flex: 1,
              fontSize: 11,
              color: "#8a8a9c",
              fontFamily: "'DM Mono',monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {url}
          </div>
          <button
            onClick={handleCopy}
            style={{
              background: copied ? "#22c55e" : "#f43f5e",
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              flexShrink: 0,
              transition: "background .2s",
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        {/* How sharing works */}
        <div
          style={{
            background: "rgba(255,255,255,.02)",
            border: "1px solid rgba(255,255,255,.04)",
            borderRadius: 8,
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#4a4a60",
              textTransform: "uppercase",
              letterSpacing: 1.2,
              marginBottom: 8,
            }}
          >
            How sharing works
          </div>
          {SHARING_STEPS.map((step, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 5,
                fontSize: 11,
                color: "#7a7a90",
                lineHeight: 1.4,
              }}
            >
              <span
                style={{
                  color: "#f43f5e",
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  flexShrink: 0,
                }}
              >
                {i + 1}.
              </span>
              {step}
            </div>
          ))}
        </div>

        {/* Upgrade teaser */}
        <div
          style={{
            marginTop: 14,
            padding: "8px 10px",
            background: "rgba(99,102,241,.06)",
            borderRadius: 6,
            border: "1px solid rgba(99,102,241,.1)",
          }}
        >
          <div style={{ fontSize: 10, color: "#818cf8", lineHeight: 1.5 }}>
            <strong>No backend needed.</strong> Feedback lives in the URL. For
            persistent sync across your team, connect a Takeoff project.
          </div>
        </div>
      </div>
    </div>
  );
}
