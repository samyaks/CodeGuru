import { useState } from "react";

export interface NamePromptProps {
  onSubmit: (name: string) => void;
}

export function NamePrompt({ onSubmit }: NamePromptProps) {
  const [name, setName] = useState("");

  const submit = () => {
    if (name.trim()) onSubmit(name.trim());
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,.6)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        style={{
          background: "#181825",
          border: "1px solid rgba(255,255,255,.08)",
          borderRadius: 14,
          padding: "28px 32px",
          width: 310,
          boxShadow: "0 24px 64px rgba(0,0,0,.6)",
          animation: "bIn .2s cubic-bezier(.34,1.56,.64,1)",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "linear-gradient(135deg,#f43f5e,#e11d48)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 800,
              color: "#fff",
            }}
          >
            T
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#dcdce6" }}>
            What's your name?
          </span>
        </div>

        <p
          style={{
            fontSize: 12,
            color: "#5a5a6e",
            lineHeight: 1.5,
            margin: "0 0 14px",
          }}
        >
          So others know who left the feedback. Stored locally — never leaves
          your device.
        </p>

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) submit();
          }}
          placeholder="e.g. Priya, Jake, Sarah..."
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.1)",
            borderRadius: 8,
            padding: "10px 14px",
            color: "#dcdce6",
            fontSize: 14,
            fontFamily: "'DM Sans',sans-serif",
            outline: "none",
          }}
        />

        <button
          onClick={submit}
          disabled={!name.trim()}
          style={{
            width: "100%",
            marginTop: 10,
            background: name.trim()
              ? "#f43f5e"
              : "rgba(244,63,94,.25)",
            border: "none",
            borderRadius: 8,
            padding: "10px",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: name.trim() ? "pointer" : "default",
            transition: "background .15s",
          }}
        >
          Start reviewing
        </button>
      </div>
    </div>
  );
}
