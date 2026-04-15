import React, { useState } from "react";
import type { Pin } from "../core/types";
import { addReply, resolvePin, reopenPin } from "../core/pins";
import { useAnnotate } from "./AnnotateContext";

interface CommentBubbleProps {
  pin: Pin;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return "just now";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function avatarColor(name: string): string {
  return `hsl(${(name.charCodeAt(0) * 47) % 360},55%,52%)`;
}

export function CommentBubble({ pin }: CommentBubbleProps) {
  const { session, setSession, mode, setActivePinId, userName } =
    useAnnotate();
  const [replyText, setReplyText] = useState("");

  const updatePin = (updatedPin: Pin) => {
    setSession((prev) => ({
      ...prev,
      pins: prev.pins.map((p) => (p.id === pin.id ? updatedPin : p)),
    }));
  };

  const submitReply = () => {
    if (!replyText.trim() || !userName) return;
    const updatedPin = addReply(pin, replyText.trim(), userName);
    updatePin(updatedPin);
    setReplyText("");
  };

  const handleResolveToggle = () => {
    const updatedPin = pin.resolved ? reopenPin(pin) : resolvePin(pin);
    updatePin(updatedPin);
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: pin.x + 16,
        top: pin.y + 6,
        width: 268,
        background: "#181825",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 12,
        boxShadow: "0 16px 48px rgba(0,0,0,.55)",
        zIndex: 10003,
        overflow: "hidden",
        fontFamily: "'DM Sans',sans-serif",
        animation: "bIn .18s cubic-bezier(.34,1.56,.64,1)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 14px 8px",
          borderBottom: "1px solid rgba(255,255,255,.05)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: avatarColor(pin.author),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {pin.author[0].toUpperCase()}
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#dcdce6" }}>
            {pin.author}
          </span>
          <span style={{ fontSize: 10, color: "#4a4a60" }}>
            {formatRelativeTime(pin.timestamp)}
          </span>
        </div>
        <button
          onClick={() => setActivePinId(null)}
          style={{
            background: "none",
            border: "none",
            color: "#4a4a60",
            cursor: "pointer",
            fontSize: 15,
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          padding: "10px 14px 8px",
          fontSize: 13,
          color: "#b8b8c8",
          lineHeight: 1.55,
        }}
      >
        {pin.text}
      </div>

      {/* Element context badge */}
      {pin.elementContext && (
        <div
          style={{
            margin: "0 14px 6px",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 7px",
            background: "rgba(244,63,94,.07)",
            border: "1px solid rgba(244,63,94,.12)",
            borderRadius: 4,
            fontSize: 9,
            color: "#e8667a",
            fontFamily: "'DM Mono',monospace",
          }}
        >
          ◎ &lt;{pin.elementContext.tag}&gt;
          {pin.elementContext.classes.length > 0 &&
            `.${pin.elementContext.classes[0]}`}
        </div>
      )}

      {/* Reply thread */}
      {pin.replies.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,.04)" }}>
          {pin.replies.map((r, i) => (
            <div
              key={`${r.timestamp}-${r.author}`}
              style={{
                padding: "9px 14px",
                borderBottom:
                  i < pin.replies.length - 1
                    ? "1px solid rgba(255,255,255,.03)"
                    : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 3,
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: avatarColor(r.author),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 7,
                    fontWeight: 700,
                    color: "#fff",
                  }}
                >
                  {r.author[0].toUpperCase()}
                </div>
                <span
                  style={{ fontSize: 11, fontWeight: 600, color: "#b8b8c8" }}
                >
                  {r.author}
                </span>
                <span style={{ fontSize: 9, color: "#4a4a60" }}>
                  {formatRelativeTime(r.timestamp)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#8a8a9c",
                  lineHeight: 1.5,
                  paddingLeft: 22,
                }}
              >
                {r.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reply input area */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "7px 10px",
          borderTop: "1px solid rgba(255,255,255,.05)",
          background: "rgba(0,0,0,.12)",
        }}
      >
        <input
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Reply..."
          onKeyDown={(e) => {
            if (e.key === "Enter") submitReply();
          }}
          style={{
            flex: 1,
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.07)",
            borderRadius: 6,
            padding: "6px 9px",
            color: "#dcdce6",
            fontSize: 12,
            fontFamily: "'DM Sans',sans-serif",
            outline: "none",
          }}
        />
        <button
          onClick={submitReply}
          style={{
            background: "#f43f5e",
            border: "none",
            borderRadius: 6,
            padding: "6px 10px",
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Send
        </button>
      </div>

      {/* Resolve/Reopen button */}
      {mode === "annotate" && (
        <div
          style={{
            padding: "5px 10px 7px",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={handleResolveToggle}
            style={{
              background: "none",
              border: "1px solid rgba(255,255,255,.07)",
              borderRadius: 5,
              padding: "3px 9px",
              color: "#5a5a6e",
              fontSize: 10,
              cursor: "pointer",
              fontFamily: "'DM Sans',sans-serif",
            }}
          >
            {pin.resolved ? "↩ Reopen" : "✓ Resolve"}
          </button>
        </div>
      )}
    </div>
  );
}
