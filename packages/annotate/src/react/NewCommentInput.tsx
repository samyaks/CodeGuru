import React, { useState } from "react";
import type { ElementContext } from "../core/types";
import { useAnnotate } from "./AnnotateContext";

interface NewCommentInputProps {
  pendingClick: {
    x: number;
    y: number;
    elementContext: ElementContext | null;
  };
  onSubmit: (text: string) => void;
  onCancel: () => void;
  pinNumber: number;
}

export function NewCommentInput({
  pendingClick,
  onSubmit,
  onCancel,
  pinNumber,
}: NewCommentInputProps) {
  const { userName } = useAnnotate();
  const [text, setText] = useState("");

  const handleSubmit = () => {
    if (text.trim()) onSubmit(text.trim());
  };

  const displayName = userName || "You";

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: pendingClick.x + 16,
        top: pendingClick.y + 6,
        width: 250,
        background: "#181825",
        border: "1px solid rgba(244,63,94,.2)",
        borderRadius: 12,
        boxShadow: "0 16px 48px rgba(0,0,0,.55)",
        zIndex: 10005,
        overflow: "hidden",
        animation: "bIn .18s cubic-bezier(.34,1.56,.64,1)",
      }}
    >
      {/* Pin preview teardrop */}
      <div
        style={{
          position: "absolute",
          left: -13,
          top: -1,
          width: 21,
          height: 21,
          borderRadius: "50% 50% 50% 0",
          transform: "rotate(-45deg)",
          background: "#f43f5e",
          boxShadow: "0 0 0 3px rgba(244,63,94,.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            transform: "rotate(45deg)",
            color: "#fff",
            fontSize: 9,
            fontWeight: 700,
            fontFamily: "'DM Mono',monospace",
          }}
        >
          {pinNumber}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: "11px 12px 9px" }}>
        {/* Author row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 7,
          }}
        >
          <div
            style={{
              width: 17,
              height: 17,
              borderRadius: "50%",
              background: `hsl(${(displayName.charCodeAt(0) * 47) % 360},55%,52%)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 8,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {displayName[0].toUpperCase()}
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#b8b8c8" }}>
            {displayName}
          </span>
        </div>

        {/* Textarea */}
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
            if (e.key === "Escape") {
              onCancel();
            }
          }}
          placeholder="Leave feedback..."
          rows={2}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.07)",
            borderRadius: 6,
            padding: "7px 9px",
            color: "#dcdce6",
            fontSize: 12,
            fontFamily: "'DM Sans',sans-serif",
            outline: "none",
            resize: "none",
            lineHeight: 1.5,
          }}
        />

        {/* Element context badge */}
        {pendingClick.elementContext && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 6px",
              marginTop: 4,
              background: "rgba(244,63,94,.06)",
              borderRadius: 3,
              fontSize: 9,
              color: "#e8667a",
              fontFamily: "'DM Mono',monospace",
            }}
          >
            ◎ &lt;{pendingClick.elementContext.tag}&gt;
            {pendingClick.elementContext.classes.length > 0 &&
              `.${pendingClick.elementContext.classes[0]}`}
          </div>
        )}

        {/* Button row */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 5,
            marginTop: 7,
          }}
        >
          <button
            onClick={onCancel}
            style={{
              background: "none",
              border: "1px solid rgba(255,255,255,.07)",
              borderRadius: 6,
              padding: "4px 10px",
              color: "#4a4a60",
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            style={{
              background: text.trim()
                ? "#f43f5e"
                : "rgba(244,63,94,.25)",
              border: "none",
              borderRadius: 6,
              padding: "4px 12px",
              color: "#fff",
              fontSize: 10,
              fontWeight: 600,
              cursor: text.trim() ? "pointer" : "default",
              transition: "background .15s",
            }}
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}
