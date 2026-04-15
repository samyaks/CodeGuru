import { useState } from "react";
import type { Session } from "../core/types";
import { createSession } from "../core/session";
import { useAnnotate } from "./AnnotateContext";

export interface SessionBarProps {
  onShareClick: () => void;
}

export function SessionBar({ onShareClick }: SessionBarProps) {
  const { session, setSession } = useAnnotate();
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(session.name);

  const pinCount = session.pins.length;

  const handleRename = (newName: string) => {
    const name = newName.trim() || session.name;
    setSession((prev: Session) => ({ ...prev, name }));
    setEditing(false);
  };

  const handleNewRound = () => {
    const name = window.prompt(
      "Name this feedback round:",
      "Round " + (Math.floor(Math.random() * 90) + 10),
    );
    if (name) {
      setSession(createSession(name));
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        background: "rgba(255,255,255,.02)",
        borderBottom: "1px solid rgba(255,255,255,.05)",
        fontFamily: "'DM Sans',sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#22c55e",
            flexShrink: 0,
          }}
        />
        {editing ? (
          <input
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename(editVal);
            }}
            onBlur={() => handleRename(editVal)}
            style={{
              background: "rgba(255,255,255,.06)",
              border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 4,
              padding: "3px 8px",
              color: "#dcdce6",
              fontSize: 12,
              fontFamily: "'DM Sans',sans-serif",
              outline: "none",
              fontWeight: 600,
              width: 180,
            }}
          />
        ) : (
          <span
            onClick={() => {
              setEditVal(session.name);
              setEditing(true);
            }}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#dcdce6",
              cursor: "pointer",
              borderBottom: "1px dashed rgba(255,255,255,.15)",
            }}
          >
            {session.name}
          </span>
        )}
        <span style={{ fontSize: 10, color: "#4a4a60" }}>
          · {pinCount} {pinCount === 1 ? "pin" : "pins"}
        </span>
      </div>

      <button
        onClick={onShareClick}
        style={{
          background: "rgba(255,255,255,.04)",
          border: "1px solid rgba(255,255,255,.07)",
          borderRadius: 6,
          padding: "5px 12px",
          color: "#8a8a9c",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "'DM Sans',sans-serif",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        ⤴ Share Session
      </button>

      <button
        onClick={handleNewRound}
        style={{
          background: "rgba(255,255,255,.04)",
          border: "1px solid rgba(255,255,255,.07)",
          borderRadius: 6,
          padding: "5px 10px",
          color: "#5a5a6e",
          fontSize: 11,
          cursor: "pointer",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        + New Round
      </button>
    </div>
  );
}
