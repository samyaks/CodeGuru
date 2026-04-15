import type { Pin } from "../core/types";
import { useAnnotate } from "./AnnotateContext";

export function FeedbackPanel() {
  const { session, activePinId, setActivePinId, panelOpen, setPanelOpen } =
    useAnnotate();

  const pins = session.pins;
  const openPins = pins
    .filter((p) => !p.resolved)
    .sort((a, b) => b.timestamp - a.timestamp);
  const resolvedPins = pins.filter((p) => p.resolved);

  const globalIndex = (pin: Pin): number => pins.indexOf(pin);

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: panelOpen ? 270 : 0,
        background: "#111120",
        borderLeft: "1px solid rgba(255,255,255,.06)",
        zIndex: 10006,
        overflow: "hidden",
        transition: "width .22s cubic-bezier(.4,0,.2,1)",
        fontFamily: "'DM Sans',sans-serif",
      }}
    >
      <div
        style={{
          width: 270,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 14px 10px",
            borderBottom: "1px solid rgba(255,255,255,.06)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#dcdce6" }}>
              Feedback
            </div>
            <div style={{ fontSize: 10, color: "#4a4a60", marginTop: 1 }}>
              {openPins.length} open · {resolvedPins.length} resolved
            </div>
          </div>
          <button
            onClick={() => setPanelOpen(false)}
            style={{
              background: "rgba(255,255,255,.04)",
              border: "none",
              borderRadius: 6,
              width: 24,
              height: 24,
              color: "#6a6a7e",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {openPins.length > 0 && (
            <>
              <div
                style={{
                  padding: "7px 14px 2px",
                  fontSize: 9,
                  fontWeight: 700,
                  color: "#4a4a60",
                  textTransform: "uppercase",
                  letterSpacing: 1.3,
                }}
              >
                Open
              </div>
              {openPins.map((p) => {
                const gi = globalIndex(p);
                return (
                  <div
                    key={p.id}
                    onClick={() => setActivePinId(p.id)}
                    style={{
                      padding: "8px 14px",
                      cursor: "pointer",
                      background:
                        activePinId === p.id
                          ? "rgba(244,63,94,.06)"
                          : "transparent",
                      borderLeft:
                        activePinId === p.id
                          ? "2px solid #f43f5e"
                          : "2px solid transparent",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 2,
                      }}
                    >
                      <span
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: "50%",
                          background: "#f43f5e",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 8,
                          fontWeight: 700,
                          color: "#fff",
                          fontFamily: "'DM Mono',monospace",
                        }}
                      >
                        {gi + 1}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#b8b8c8",
                        }}
                      >
                        {p.author}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        paddingLeft: 21,
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          fontSize: 11,
                          color: "#6a6a7e",
                          lineHeight: 1.4,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.text}
                      </div>
                      {p.replies.length > 0 && (
                        <span
                          style={{
                            fontSize: 9,
                            color: "#4a4a60",
                            flexShrink: 0,
                            fontFamily: "'DM Mono',monospace",
                          }}
                        >
                          💬 {p.replies.length}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {resolvedPins.length > 0 && (
            <>
              <div
                style={{
                  padding: "9px 14px 2px",
                  fontSize: 9,
                  fontWeight: 700,
                  color: "#4a4a60",
                  textTransform: "uppercase",
                  letterSpacing: 1.3,
                }}
              >
                Resolved
              </div>
              {resolvedPins.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setActivePinId(p.id)}
                  style={{
                    padding: "6px 14px",
                    cursor: "pointer",
                    opacity: 0.4,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "#6a6a7e",
                      textDecoration: "line-through",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.text}
                  </div>
                </div>
              ))}
            </>
          )}

          {pins.length === 0 && (
            <div style={{ padding: "36px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>💬</div>
              <div style={{ fontSize: 11, color: "#4a4a60" }}>
                No feedback yet
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
