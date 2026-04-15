import { useAnnotate } from "./AnnotateContext";

export function AnnotateIndicator() {
  const { userName } = useAnnotate();

  return (
    <div
      style={{
        background: "rgba(244,63,94,.05)",
        borderBottom: "1px solid rgba(244,63,94,.1)",
        padding: "6px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#f43f5e",
          animation: "pulse 2s infinite",
        }}
      />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#f43f5e",
          fontFamily: "'DM Mono',monospace",
        }}
      >
        Click anywhere to leave feedback
      </span>
      {userName && (
        <span style={{ fontSize: 10, color: "#5a5a6e", marginLeft: 6 }}>
          as{" "}
          <strong style={{ color: "#b8b8c8" }}>{userName}</strong>
        </span>
      )}
    </div>
  );
}
