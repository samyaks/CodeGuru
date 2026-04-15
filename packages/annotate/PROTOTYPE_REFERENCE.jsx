import { useState, useRef, useCallback, useEffect } from "react";

const uid = () => Math.random().toString(36).slice(2, 8);

/* ═══════════════════════════════════════
   SIMPLE COMPRESSION (LZ-ish for demo)
   For production: use lz-string library
   ═══════════════════════════════════════ */
const encodeState = (obj) => {
  try {
    return btoa(encodeURIComponent(JSON.stringify(obj)));
  } catch { return ""; }
};
const decodeState = (str) => {
  try {
    return JSON.parse(decodeURIComponent(atob(str)));
  } catch { return null; }
};

/* ═══════════════════════════════════
   PIN
   ═══════════════════════════════════ */
function Pin({ pin, idx, isActive, onClick, mode }) {
  if (mode === "clean") return null;
  return (
    <div onClick={(e) => { e.stopPropagation(); onClick(pin.id); }} style={{
      position: "absolute", left: pin.x, top: pin.y,
      transform: `translate(-50%,-100%) scale(${isActive ? 1.18 : 1})`,
      zIndex: isActive ? 10002 : 10001, cursor: "pointer",
      transition: "transform .18s cubic-bezier(.34,1.56,.64,1), opacity .2s",
      opacity: pin.resolved ? 0.4 : 1,
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50% 50% 50% 0",
        transform: "rotate(-45deg)",
        background: pin.resolved ? "#4b5563" : "#f43f5e",
        boxShadow: isActive ? "0 0 0 3px rgba(244,63,94,.25),0 4px 16px rgba(0,0,0,.35)" : "0 2px 8px rgba(0,0,0,.3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "box-shadow .18s",
      }}>
        <span style={{
          transform: "rotate(45deg)", color: "#fff", fontSize: 10,
          fontWeight: 700, fontFamily: "'DM Mono',monospace", userSelect: "none",
        }}>{idx + 1}</span>
      </div>
      {pin.replies?.length > 0 && !isActive && (
        <div style={{
          position: "absolute", top: -4, right: -8,
          width: 15, height: 15, borderRadius: "50%",
          background: "#1e1e2f", border: "1.5px solid #f43f5e",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 7, fontWeight: 700, color: "#f43f5e", fontFamily: "'DM Mono',monospace",
        }}>{pin.replies.length}</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════
   COMMENT BUBBLE
   ═══════════════════════════════════ */
function Bubble({ pin, onClose, onReply, onResolve, canAnnotate }) {
  const [reply, setReply] = useState("");
  const submit = () => { if (reply.trim()) { onReply(pin.id, reply.trim()); setReply(""); } };
  return (
    <div onClick={(e) => e.stopPropagation()} style={{
      position: "absolute", left: pin.x + 16, top: pin.y + 6,
      width: 268, background: "#181825",
      border: "1px solid rgba(255,255,255,.08)", borderRadius: 12,
      boxShadow: "0 16px 48px rgba(0,0,0,.55)", zIndex: 10003,
      overflow: "hidden", fontFamily: "'DM Sans',sans-serif",
      animation: "bIn .18s cubic-bezier(.34,1.56,.64,1)",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px 8px", borderBottom: "1px solid rgba(255,255,255,.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{
            width: 20, height: 20, borderRadius: "50%",
            background: `hsl(${(pin.author.charCodeAt(0)*47)%360},55%,52%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 700, color: "#fff",
          }}>{pin.author[0].toUpperCase()}</div>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#dcdce6" }}>{pin.author}</span>
          <span style={{ fontSize: 10, color: "#4a4a60" }}>{pin.time}</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#4a4a60", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }}>×</button>
      </div>
      <div style={{ padding: "10px 14px 8px", fontSize: 13, color: "#b8b8c8", lineHeight: 1.55 }}>{pin.text}</div>
      {pin.el && (
        <div style={{
          margin: "0 14px 6px", display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 7px", background: "rgba(244,63,94,.07)",
          border: "1px solid rgba(244,63,94,.12)", borderRadius: 4,
          fontSize: 9, color: "#e8667a", fontFamily: "'DM Mono',monospace",
        }}>◎ {pin.el}</div>
      )}
      {pin.replies?.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,.04)" }}>
          {pin.replies.map((r, i) => (
            <div key={i} style={{ padding: "9px 14px", borderBottom: i < pin.replies.length - 1 ? "1px solid rgba(255,255,255,.03)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: `hsl(${(r.author.charCodeAt(0)*47)%360},55%,52%)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 7, fontWeight: 700, color: "#fff",
                }}>{r.author[0].toUpperCase()}</div>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#b8b8c8" }}>{r.author}</span>
                <span style={{ fontSize: 9, color: "#4a4a60" }}>{r.time}</span>
              </div>
              <div style={{ fontSize: 12, color: "#8a8a9c", lineHeight: 1.5, paddingLeft: 22 }}>{r.text}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, padding: "7px 10px", borderTop: "1px solid rgba(255,255,255,.05)", background: "rgba(0,0,0,.12)" }}>
        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply..."
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          style={{
            flex: 1, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)",
            borderRadius: 6, padding: "6px 9px", color: "#dcdce6", fontSize: 12,
            fontFamily: "'DM Sans',sans-serif", outline: "none",
          }}
        />
        <button onClick={submit} style={{
          background: "#f43f5e", border: "none", borderRadius: 6,
          padding: "6px 10px", color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer",
        }}>Send</button>
      </div>
      {canAnnotate && (
        <div style={{ padding: "5px 10px 7px", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={() => onResolve(pin.id)} style={{
            background: "none", border: "1px solid rgba(255,255,255,.07)",
            borderRadius: 5, padding: "3px 9px", color: "#5a5a6e", fontSize: 10,
            cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
          }}>{pin.resolved ? "↩ Reopen" : "✓ Resolve"}</button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════
   NAME PROMPT
   ═══════════════════════════════════ */
function NamePrompt({ onSubmit }) {
  const [name, setName] = useState("");
  return (
    <div onClick={(e) => e.stopPropagation()} style={{
      position: "fixed", inset: 0, zIndex: 20000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,.6)", backdropFilter: "blur(6px)",
    }}>
      <div style={{
        background: "#181825", border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 14, padding: "28px 32px", width: 310,
        boxShadow: "0 24px 64px rgba(0,0,0,.6)",
        animation: "bIn .2s cubic-bezier(.34,1.56,.64,1)",
        fontFamily: "'DM Sans',sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 6,
            background: "linear-gradient(135deg,#f43f5e,#e11d48)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 800, color: "#fff",
          }}>T</div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#dcdce6" }}>What's your name?</span>
        </div>
        <p style={{ fontSize: 12, color: "#5a5a6e", lineHeight: 1.5, margin: "0 0 14px" }}>
          So others know who left the feedback. Stored locally — never leaves your device.
        </p>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSubmit(name.trim()); }}
          placeholder="e.g. Priya, Jake, Sarah..."
          style={{
            width: "100%", boxSizing: "border-box",
            background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)",
            borderRadius: 8, padding: "10px 14px", color: "#dcdce6", fontSize: 14,
            fontFamily: "'DM Sans',sans-serif", outline: "none",
          }}
        />
        <button onClick={() => { if (name.trim()) onSubmit(name.trim()); }}
          disabled={!name.trim()}
          style={{
            width: "100%", marginTop: 10,
            background: name.trim() ? "#f43f5e" : "rgba(244,63,94,.25)",
            border: "none", borderRadius: 8, padding: "10px",
            color: "#fff", fontSize: 13, fontWeight: 600,
            cursor: name.trim() ? "pointer" : "default", transition: "background .15s",
          }}>Start reviewing</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   SESSION MANAGER
   ═══════════════════════════════════ */
function SessionBar({ session, onShare, onNewSession, onRename, pinCount }) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(session.name);
  const [copied, setCopied] = useState(false);

  const handleShare = () => {
    onShare();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 16px",
      background: "rgba(255,255,255,.02)",
      borderBottom: "1px solid rgba(255,255,255,.05)",
      fontFamily: "'DM Sans',sans-serif",
    }}>
      {/* Session name */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "#22c55e", flexShrink: 0,
        }} />
        {editing ? (
          <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { onRename(editVal.trim() || session.name); setEditing(false); } }}
            onBlur={() => { onRename(editVal.trim() || session.name); setEditing(false); }}
            style={{
              background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 4, padding: "3px 8px", color: "#dcdce6", fontSize: 12,
              fontFamily: "'DM Sans',sans-serif", outline: "none", fontWeight: 600, width: 180,
            }}
          />
        ) : (
          <span onClick={() => setEditing(true)} style={{
            fontSize: 12, fontWeight: 600, color: "#dcdce6", cursor: "pointer",
            borderBottom: "1px dashed rgba(255,255,255,.15)",
          }}>{session.name}</span>
        )}
        <span style={{ fontSize: 10, color: "#4a4a60" }}>
          · {pinCount} {pinCount === 1 ? "pin" : "pins"}
        </span>
      </div>

      {/* Actions */}
      <button onClick={handleShare} style={{
        background: copied ? "rgba(34,197,94,.12)" : "rgba(255,255,255,.04)",
        border: `1px solid ${copied ? "rgba(34,197,94,.2)" : "rgba(255,255,255,.07)"}`,
        borderRadius: 6, padding: "5px 12px",
        color: copied ? "#22c55e" : "#8a8a9c",
        fontSize: 11, fontWeight: 600, cursor: "pointer",
        fontFamily: "'DM Sans',sans-serif",
        display: "flex", alignItems: "center", gap: 5,
        transition: "all .2s",
      }}>
        {copied ? "✓ Copied!" : "⤴ Share Session"}
      </button>

      <button onClick={onNewSession} style={{
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.07)",
        borderRadius: 6, padding: "5px 10px", color: "#5a5a6e",
        fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
      }}>+ New Round</button>
    </div>
  );
}

/* ═══════════════════════════════════
   SHARE MODAL
   ═══════════════════════════════════ */
function ShareModal({ url, sessionName, onClose }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 20000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#181825", border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 14, padding: "24px 28px", width: 400,
        boxShadow: "0 24px 64px rgba(0,0,0,.6)",
        animation: "bIn .2s cubic-bezier(.34,1.56,.64,1)",
        fontFamily: "'DM Sans',sans-serif",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#dcdce6" }}>Share "{sessionName}"</div>
            <div style={{ fontSize: 11, color: "#5a5a6e", marginTop: 2 }}>
              Anyone with this link can view and add feedback
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#4a4a60", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>

        {/* URL display */}
        <div style={{
          background: "rgba(0,0,0,.2)", border: "1px solid rgba(255,255,255,.06)",
          borderRadius: 8, padding: "10px 12px",
          display: "flex", alignItems: "center", gap: 8,
          marginBottom: 14,
        }}>
          <div style={{
            flex: 1, fontSize: 11, color: "#8a8a9c",
            fontFamily: "'DM Mono',monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{url}</div>
          <button onClick={handleCopy} style={{
            background: copied ? "#22c55e" : "#f43f5e",
            border: "none", borderRadius: 6, padding: "6px 14px",
            color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
            flexShrink: 0, transition: "background .2s",
          }}>{copied ? "Copied!" : "Copy"}</button>
        </div>

        {/* How it works */}
        <div style={{
          background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.04)",
          borderRadius: 8, padding: "12px 14px",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#4a4a60", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>How sharing works</div>
          {[
            "Your teammate opens the link → sees all existing pins",
            "They switch to Annotate → add their own feedback",
            "They click Share → get an updated URL with their additions",
            "Collect all URLs to see everyone's feedback combined",
          ].map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11, color: "#7a7a90", lineHeight: 1.4 }}>
              <span style={{ color: "#f43f5e", fontFamily: "'DM Mono',monospace", fontSize: 10, flexShrink: 0 }}>{i + 1}.</span>
              {s}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14, padding: "8px 10px", background: "rgba(99,102,241,.06)", borderRadius: 6, border: "1px solid rgba(99,102,241,.1)" }}>
          <div style={{ fontSize: 10, color: "#818cf8", lineHeight: 1.5 }}>
            <strong>No backend needed.</strong> Feedback lives in the URL. For persistent sync across your team, connect a Takeoff project.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   FEEDBACK PANEL
   ═══════════════════════════════════ */
function Panel({ pins, activePinId, onPinClick, onClose, isOpen }) {
  const open = pins.filter((p) => !p.resolved);
  const resolved = pins.filter((p) => p.resolved);
  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: isOpen ? 270 : 0,
      background: "#111120", borderLeft: "1px solid rgba(255,255,255,.06)",
      zIndex: 10006, overflow: "hidden", transition: "width .22s cubic-bezier(.4,0,.2,1)",
      fontFamily: "'DM Sans',sans-serif",
    }}>
      <div style={{ width: 270, height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{
          padding: "14px 14px 10px", borderBottom: "1px solid rgba(255,255,255,.06)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#dcdce6" }}>Feedback</div>
            <div style={{ fontSize: 10, color: "#4a4a60", marginTop: 1 }}>{open.length} open · {resolved.length} resolved</div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,.04)", border: "none", borderRadius: 6,
            width: 24, height: 24, color: "#6a6a7e", cursor: "pointer", fontSize: 12,
          }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {open.length > 0 && <>
            <div style={{ padding: "7px 14px 2px", fontSize: 9, fontWeight: 700, color: "#4a4a60", textTransform: "uppercase", letterSpacing: 1.3 }}>Open</div>
            {open.map((p) => {
              const gi = pins.indexOf(p);
              return (
                <div key={p.id} onClick={() => onPinClick(p.id)} style={{
                  padding: "8px 14px", cursor: "pointer",
                  background: activePinId === p.id ? "rgba(244,63,94,.06)" : "transparent",
                  borderLeft: activePinId === p.id ? "2px solid #f43f5e" : "2px solid transparent",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span style={{
                      width: 15, height: 15, borderRadius: "50%", background: "#f43f5e",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 8, fontWeight: 700, color: "#fff", fontFamily: "'DM Mono',monospace",
                    }}>{gi + 1}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#b8b8c8" }}>{p.author}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#6a6a7e", lineHeight: 1.4, paddingLeft: 21, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.text}</div>
                </div>
              );
            })}
          </>}
          {resolved.length > 0 && <>
            <div style={{ padding: "9px 14px 2px", fontSize: 9, fontWeight: 700, color: "#4a4a60", textTransform: "uppercase", letterSpacing: 1.3 }}>Resolved</div>
            {resolved.map((p) => (
              <div key={p.id} onClick={() => onPinClick(p.id)} style={{ padding: "6px 14px", cursor: "pointer", opacity: 0.4 }}>
                <div style={{ fontSize: 11, color: "#6a6a7e", textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.text}</div>
              </div>
            ))}
          </>}
          {pins.length === 0 && (
            <div style={{ padding: "36px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>💬</div>
              <div style={{ fontSize: 11, color: "#4a4a60" }}>No feedback yet</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   FLOATING PILL
   ═══════════════════════════════════ */
function Pill({ mode, onMode, openCount, onPanel }) {
  const [expanded, setExpanded] = useState(false);
  if (mode === "clean" && !expanded) {
    return (
      <div onClick={() => setExpanded(true)} style={{
        position: "fixed", bottom: 16, right: 16, zIndex: 10010,
        width: 30, height: 30, borderRadius: "50%",
        background: "rgba(24,24,37,.7)", border: "1px solid rgba(255,255,255,.06)",
        backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", opacity: 0.45, transition: "all .2s",
      }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "scale(1.12)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.45"; e.currentTarget.style.transform = "scale(1)"; }}
      >
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: "linear-gradient(135deg,#f43f5e,#e11d48)" }} />
      </div>
    );
  }
  return (
    <div style={{
      position: "fixed", bottom: 16, right: 16, zIndex: 10010,
      animation: "bIn .2s cubic-bezier(.34,1.56,.64,1)",
    }}>
      <div style={{
        display: "flex", alignItems: "center",
        background: "rgba(24,24,37,.92)", border: "1px solid rgba(255,255,255,.08)",
        backdropFilter: "blur(12px)", borderRadius: 28,
        padding: "4px 5px", boxShadow: "0 8px 32px rgba(0,0,0,.4)", gap: 3,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          background: "linear-gradient(135deg,#f43f5e,#e11d48)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 800, color: "#fff", fontFamily: "'DM Mono',monospace", flexShrink: 0,
        }}>T</div>
        {[
          { key: "clean", label: "Clean", icon: "◯" },
          { key: "review", label: "Review", icon: "◉" },
          { key: "annotate", label: "Annotate", icon: "✎" },
        ].map((m) => (
          <button key={m.key} onClick={() => {
            onMode(m.key);
            if (m.key === "clean") setExpanded(false);
          }} style={{
            background: mode === m.key
              ? (m.key === "annotate" ? "rgba(244,63,94,.18)" : m.key === "review" ? "rgba(99,102,241,.15)" : "rgba(255,255,255,.06)")
              : "transparent",
            border: "none", borderRadius: 20, padding: "5px 11px",
            color: mode === m.key
              ? (m.key === "annotate" ? "#f43f5e" : m.key === "review" ? "#818cf8" : "#dcdce6")
              : "#5a5a6e",
            fontSize: 11, fontWeight: mode === m.key ? 700 : 500, cursor: "pointer",
            fontFamily: "'DM Sans',sans-serif", transition: "all .15s",
            display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
          }}>
            <span style={{ fontSize: 9 }}>{m.icon}</span>{m.label}
          </button>
        ))}
        {mode !== "clean" && <>
          <div style={{ width: 1, height: 18, background: "rgba(255,255,255,.07)", margin: "0 2px" }} />
          <button onClick={onPanel} style={{
            background: "rgba(255,255,255,.04)", border: "none", borderRadius: 20,
            padding: "5px 9px", color: "#8a8a9c", fontSize: 11, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            💬
            {openCount > 0 && (
              <span style={{
                background: "#f43f5e", color: "#fff", borderRadius: 10,
                padding: "0 5px", fontSize: 9, fontWeight: 700, lineHeight: "15px", minWidth: 15, textAlign: "center",
              }}>{openCount}</span>
            )}
          </button>
        </>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   FAKE APP
   ═══════════════════════════════════ */
function FakeApp() {
  return (
    <div style={{ padding: "26px 34px", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 12, fontFamily: "'DM Mono',monospace" }}>P</div>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#dcdce6" }}>PulseBoard</span>
          <span style={{ fontSize: 9, color: "#4a4a60", background: "rgba(99,102,241,.12)", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>PROTOTYPE</span>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          {["Dashboard", "Customers", "Analytics", "Settings"].map((t) => (
            <span key={t} style={{ fontSize: 12, color: t === "Dashboard" ? "#dcdce6" : "#4a4a60", fontWeight: t === "Dashboard" ? 600 : 400, cursor: "pointer" }}>{t}</span>
          ))}
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#ec4899,#f43f5e)" }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 22 }}>
        {[
          { l: "Active Users", v: "2,847", d: "+12%", u: true },
          { l: "Revenue", v: "$48.2k", d: "+8.3%", u: true },
          { l: "Churn Rate", v: "3.2%", d: "-0.4%", u: false },
          { l: "NPS Score", v: "72", d: "+5", u: true },
        ].map((s) => (
          <div key={s.l} style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 10, padding: "15px 16px" }}>
            <div style={{ fontSize: 10, color: "#4a4a60", marginBottom: 4, fontWeight: 500 }}>{s.l}</div>
            <div style={{ fontSize: 21, fontWeight: 700, color: "#dcdce6", fontFamily: "'DM Mono',monospace" }}>{s.v}</div>
            <div style={{ fontSize: 10, color: s.u ? "#22c55e" : "#f43f5e", marginTop: 3, fontWeight: 500 }}>{s.d} vs last month</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 12 }}>
        <div style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 10, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#dcdce6", marginBottom: 12 }}>Revenue Trend</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 105 }}>
            {[38,52,43,62,75,58,80,68,88,83,93,86].map((h, i) => (
              <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: "3px 3px 0 0", background: i === 11 ? "linear-gradient(to top,#6366f1,#8b5cf6)" : "rgba(99,102,241,.18)" }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
            {["J","F","M","A","M","J","J","A","S","O","N","D"].map((m) => (
              <span key={m} style={{ fontSize: 8, color: "#3a3a4e", flex: 1, textAlign: "center" }}>{m}</span>
            ))}
          </div>
        </div>
        <div style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 10, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#dcdce6", marginBottom: 12 }}>Recent Signups</div>
          {[
            { n: "Sarah Chen", e: "sarah@acme.co", p: "Pro" },
            { n: "Marcus Webb", e: "marcus@studio.io", p: "Starter" },
            { n: "Aisha Patel", e: "aisha@newco.com", p: "Pro" },
            { n: "Jake Foster", e: "jake@build.dev", p: "Enterprise" },
            { n: "Lena Müller", e: "lena@craft.de", p: "Starter" },
          ].map((u) => (
            <div key={u.e} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.03)" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#b8b8c8" }}>{u.n}</div>
                <div style={{ fontSize: 9, color: "#4a4a60" }}>{u.e}</div>
              </div>
              <span style={{
                fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                background: u.p === "Enterprise" ? "rgba(244,63,94,.1)" : u.p === "Pro" ? "rgba(99,102,241,.1)" : "rgba(255,255,255,.04)",
                color: u.p === "Enterprise" ? "#f43f5e" : u.p === "Pro" ? "#818cf8" : "#5a5a6e",
              }}>{u.p}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
        <button style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", borderRadius: 8, padding: "9px 18px", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Export Report</button>
        <button style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 8, padding: "9px 18px", color: "#8a8a9c", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>Invite Team</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════ */

const DEMO_PINS = [
  { id: "d1", x: 340, y: 140, text: "Can we make the NPS score more prominent? It's our key metric for the board.", author: "Priya", time: "2m ago", el: "<div> .stat-card", replies: [{ author: "Jake", time: "1m ago", text: "Agreed — hero number at the top?" }], resolved: false },
  { id: "d2", x: 560, y: 300, text: "Chart colors are too muted. Hard to read at a glance on the projector.", author: "Marcus", time: "5m ago", el: "<div> .chart", replies: [], resolved: false },
  { id: "d3", x: 790, y: 168, text: "Love the signup list. Can we add a 'last active' column?", author: "Sarah", time: "12m ago", el: "<div> .signup-table", replies: [{ author: "Priya", time: "8m ago", text: "Good idea. Also filter by plan type?" }], resolved: true },
];

export default function App() {
  const [mode, setMode] = useState("clean");
  const [pins, setPins] = useState(DEMO_PINS);
  const [session, setSession] = useState({ name: "Sprint 12 Review", created: Date.now() });
  const [activePinId, setActivePinId] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [pendingClick, setPendingClick] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [userName, setUserName] = useState(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const surfaceRef = useRef(null);

  // Build shareable URL
  const getShareUrl = useCallback(() => {
    const payload = { s: session.name, p: pins.map((p) => ({ x: p.x, y: p.y, t: p.text, a: p.author, e: p.el, r: p.replies?.map((r) => ({ a: r.author, t: r.text })) || [], d: p.resolved })) };
    const encoded = encodeState(payload);
    const base = window.location.origin + window.location.pathname;
    return base + "?tf=" + encoded;
  }, [session, pins]);

  const handleShare = () => setShowShareModal(true);

  const handleNewSession = () => {
    const name = prompt("Name this feedback round:", "Round " + (Math.floor(Math.random() * 90) + 10));
    if (name) {
      setSession({ name, created: Date.now() });
      setPins([]);
      setActivePinId(null);
    }
  };

  const handleSurfaceClick = useCallback((e) => {
    if (mode === "clean") return;
    if (mode === "review") { setActivePinId(null); return; }
    if (mode === "annotate") {
      if (!userName) { setShowNamePrompt(true); return; }
      const rect = surfaceRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + surfaceRef.current.scrollLeft;
      const y = e.clientY - rect.top + surfaceRef.current.scrollTop;
      let elTag = "";
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) {
        const tag = el.tagName.toLowerCase();
        const cls = el.className && typeof el.className === "string" ? "." + el.className.split(" ").filter(Boolean)[0] : "";
        elTag = `<${tag}>${cls}`;
      }
      setActivePinId(null);
      setPendingClick({ x, y, el: elTag });
      setCommentText("");
    }
  }, [mode, userName]);

  const submitComment = () => {
    if (!pendingClick || !commentText.trim() || !userName) return;
    const p = { id: uid(), x: pendingClick.x, y: pendingClick.y, text: commentText.trim(), author: userName, time: "now", el: pendingClick.el, replies: [], resolved: false };
    setPins((prev) => [...prev, p]);
    setPendingClick(null);
    setCommentText("");
    setActivePinId(p.id);
  };

  const addReply = (pinId, text) => {
    setPins((prev) => prev.map((p) => p.id === pinId ? { ...p, replies: [...(p.replies || []), { author: userName || "Anon", time: "now", text }] } : p));
  };
  const toggleResolve = (pinId) => {
    setPins((prev) => prev.map((p) => p.id === pinId ? { ...p, resolved: !p.resolved } : p));
  };

  const activePin = pins.find((p) => p.id === activePinId);
  const openCount = pins.filter((p) => !p.resolved).length;

  return (
    <div style={{ background: "#0c0c14", minHeight: "100vh", color: "#dcdce6", fontFamily: "'DM Sans',sans-serif", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style>{`@keyframes bIn{from{opacity:0;transform:scale(.92) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>

      {/* Session bar — visible in review + annotate */}
      {mode !== "clean" && (
        <SessionBar
          session={session}
          onShare={handleShare}
          onNewSession={handleNewSession}
          onRename={(name) => setSession((s) => ({ ...s, name }))}
          pinCount={pins.length}
        />
      )}

      {/* Annotate indicator */}
      {mode === "annotate" && (
        <div style={{
          background: "rgba(244,63,94,.05)", borderBottom: "1px solid rgba(244,63,94,.1)",
          padding: "6px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f43f5e", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "#f43f5e", fontFamily: "'DM Mono',monospace" }}>
            Click anywhere to leave feedback
          </span>
          {userName && <span style={{ fontSize: 10, color: "#5a5a6e", marginLeft: 6 }}>as <strong style={{ color: "#b8b8c8" }}>{userName}</strong></span>}
        </div>
      )}

      {/* Surface */}
      <div ref={surfaceRef} onClick={handleSurfaceClick} style={{
        position: "relative",
        cursor: mode === "annotate" ? "crosshair" : "default",
        minHeight: "calc(100vh - 80px)",
        marginRight: panelOpen && mode !== "clean" ? 270 : 0,
        transition: "margin-right .22s cubic-bezier(.4,0,.2,1)",
      }}>
        <FakeApp />

        {pins.map((pin, i) => (
          <Pin key={pin.id} pin={pin} idx={i} isActive={activePinId === pin.id}
            onClick={(id) => { if (mode !== "clean") setActivePinId(id); }} mode={mode} />
        ))}

        {activePin && mode !== "clean" && (
          <Bubble pin={activePin} onClose={() => setActivePinId(null)}
            onReply={addReply} onResolve={toggleResolve} canAnnotate={mode === "annotate"} />
        )}

        {pendingClick && mode === "annotate" && (
          <div onClick={(e) => e.stopPropagation()} style={{
            position: "absolute", left: pendingClick.x + 16, top: pendingClick.y + 6,
            width: 250, background: "#181825", border: "1px solid rgba(244,63,94,.2)",
            borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,.55)", zIndex: 10005,
            overflow: "hidden", animation: "bIn .18s cubic-bezier(.34,1.56,.64,1)",
          }}>
            <div style={{
              position: "absolute", left: -13, top: -1,
              width: 21, height: 21, borderRadius: "50% 50% 50% 0",
              transform: "rotate(-45deg)", background: "#f43f5e",
              boxShadow: "0 0 0 3px rgba(244,63,94,.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ transform: "rotate(45deg)", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>{pins.length + 1}</span>
            </div>
            <div style={{ padding: "11px 12px 9px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                <div style={{
                  width: 17, height: 17, borderRadius: "50%",
                  background: `hsl(${(userName||"Y").charCodeAt(0)*47%360},55%,52%)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, fontWeight: 700, color: "#fff",
                }}>{(userName||"Y")[0].toUpperCase()}</div>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#b8b8c8" }}>{userName}</span>
              </div>
              <textarea autoFocus value={commentText} onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComment(); }}}
                placeholder="Leave feedback..." rows={2}
                style={{
                  width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.07)", borderRadius: 6,
                  padding: "7px 9px", color: "#dcdce6", fontSize: 12,
                  fontFamily: "'DM Sans',sans-serif", outline: "none", resize: "none", lineHeight: 1.5,
                }}
              />
              {pendingClick.el && (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 3,
                  padding: "2px 6px", marginTop: 4, background: "rgba(244,63,94,.06)",
                  borderRadius: 3, fontSize: 9, color: "#e8667a", fontFamily: "'DM Mono',monospace",
                }}>◎ {pendingClick.el}</div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 5, marginTop: 7 }}>
                <button onClick={() => setPendingClick(null)} style={{
                  background: "none", border: "1px solid rgba(255,255,255,.07)",
                  borderRadius: 6, padding: "4px 10px", color: "#4a4a60", fontSize: 10, cursor: "pointer",
                }}>Cancel</button>
                <button onClick={submitComment} disabled={!commentText.trim()} style={{
                  background: commentText.trim() ? "#f43f5e" : "rgba(244,63,94,.25)",
                  border: "none", borderRadius: 6, padding: "4px 12px",
                  color: "#fff", fontSize: 10, fontWeight: 600,
                  cursor: commentText.trim() ? "pointer" : "default", transition: "background .15s",
                }}>Comment</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Panel */}
      <Panel pins={pins} activePinId={activePinId} onPinClick={setActivePinId}
        onClose={() => setPanelOpen(false)} isOpen={panelOpen && mode !== "clean"} />

      {/* Pill */}
      <Pill mode={mode} onMode={(m) => {
        setMode(m); setPendingClick(null); setActivePinId(null);
        if (m === "clean") setPanelOpen(false);
      }} openCount={openCount} onPanel={() => setPanelOpen(!panelOpen)} />

      {/* Modals */}
      {showNamePrompt && <NamePrompt onSubmit={(n) => { setUserName(n); setShowNamePrompt(false); }} />}
      {showShareModal && <ShareModal url={getShareUrl()} sessionName={session.name} onClose={() => setShowShareModal(false)} />}
    </div>
  );
}
