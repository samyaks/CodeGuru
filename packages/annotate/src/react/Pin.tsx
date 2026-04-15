import React from "react";
import type { Pin as PinType } from "../core/types";
import { useAnnotate } from "./AnnotateContext";

interface PinProps {
  pin: PinType;
  index: number;
}

export function Pin({ pin, index }: PinProps) {
  const { mode, activePinId, setActivePinId } = useAnnotate();

  if (mode === "clean") return null;

  const isActive = activePinId === pin.id;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        setActivePinId(pin.id);
      }}
      style={{
        position: "absolute",
        left: pin.x,
        top: pin.y,
        transform: `translate(-50%,-100%) scale(${isActive ? 1.18 : 1})`,
        zIndex: isActive ? 10002 : 10001,
        cursor: "pointer",
        transition:
          "transform .18s cubic-bezier(.34,1.56,.64,1), opacity .2s",
        opacity: pin.resolved ? 0.4 : 1,
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50% 50% 50% 0",
          transform: "rotate(-45deg)",
          background: pin.resolved ? "#4b5563" : "#f43f5e",
          boxShadow: isActive
            ? "0 0 0 3px rgba(244,63,94,.25),0 4px 16px rgba(0,0,0,.35)"
            : "0 2px 8px rgba(0,0,0,.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "box-shadow .18s",
        }}
      >
        <span
          style={{
            transform: "rotate(45deg)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "'DM Mono',monospace",
            userSelect: "none",
          }}
        >
          {index + 1}
        </span>
      </div>
      {pin.replies.length > 0 && !isActive && (
        <div
          style={{
            position: "absolute",
            top: -4,
            right: -8,
            width: 15,
            height: 15,
            borderRadius: "50%",
            background: "#1e1e2f",
            border: "1.5px solid #f43f5e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 7,
            fontWeight: 700,
            color: "#f43f5e",
            fontFamily: "'DM Mono',monospace",
          }}
        >
          {pin.replies.length}
        </div>
      )}
    </div>
  );
}
