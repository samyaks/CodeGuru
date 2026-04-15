import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type {
  AnnotateConfig,
  AnnotateMode,
  Session,
  ElementContext,
} from "../core/types";

interface TakeoffAnnotateProps extends AnnotateConfig {
  children?: React.ReactNode;
  /** @internal Used by vanilla wrapper to toggle pointer-events on the host element */
  vanillaHost?: HTMLElement;
}
import {
  createSession,
  readSessionFromURL,
  writeSessionToURL,
} from "../core/session";
import { captureElementContext } from "../core/element-context";
import { createPin } from "../core/pins";
import { AnnotateContext } from "./AnnotateContext";
import FloatingPill from "./FloatingPill";
import { Pin } from "./Pin";
import { CommentBubble } from "./CommentBubble";
import { NewCommentInput } from "./NewCommentInput";
import { SessionBar } from "./SessionBar";
import { AnnotateIndicator } from "./AnnotateIndicator";
import { FeedbackPanel } from "./FeedbackPanel";
import { NamePrompt } from "./NamePrompt";
import { ShareModal } from "./ShareModal";

const KEYFRAMES = `
@keyframes bIn{from{opacity:0;transform:scale(.92) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
`;

export default function TakeoffAnnotate({
  children,
  projectId,
  theme = "auto",
  defaultMode = "clean",
  position = "bottom-right",
  onShare,
  onExport,
  vanillaHost,
}: TakeoffAnnotateProps) {
  const [mode, setMode] = useState<AnnotateMode>(defaultMode);
  const [session, setSession] = useState<Session>(
    () => readSessionFromURL() || createSession("Feedback Round 1"),
  );
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [userName, setUserNameState] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem("takeoff_annotate_username");
      } catch {
        return null;
      }
    },
  );
  const [pendingClick, setPendingClick] = useState<{
    x: number;
    y: number;
    elementContext: ElementContext | null;
  } | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const surfaceRef = useRef<HTMLDivElement>(null);

  const setUserName = useCallback((name: string) => {
    setUserNameState(name);
    try {
      localStorage.setItem("takeoff_annotate_username", name);
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Sync session to URL on change
  useEffect(() => {
    writeSessionToURL(session);
  }, [session]);

  // On mount: if URL contains a session, switch to review mode
  useEffect(() => {
    const urlSession = readSessionFromURL();
    if (urlSession) {
      setMode("review");
    }
  }, []);

  // Vanilla wrapper: toggle pointer-events on the host element based on mode
  useEffect(() => {
    if (!vanillaHost) return;
    vanillaHost.style.pointerEvents = mode === "clean" ? "none" : "auto";
  }, [mode, vanillaHost]);

  const handleSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (mode === "clean") return;

      if (mode === "review") {
        setActivePinId(null);
        return;
      }

      if (mode === "annotate") {
        const surface = surfaceRef.current;
        if (!surface) return;

        const elementContext = captureElementContext(
          e.nativeEvent,
          surface,
        );
        const rect = surface.getBoundingClientRect();
        const x = e.clientX - rect.left + surface.scrollLeft;
        const y = e.clientY - rect.top + surface.scrollTop;

        setActivePinId(null);
        setPendingClick({ x, y, elementContext });

        if (!userName) {
          setShowNamePrompt(true);
        }
      }
    },
    [mode, userName],
  );

  const config = useMemo<AnnotateConfig>(
    () => ({ projectId, theme, defaultMode, position, onShare, onExport }),
    [projectId, theme, defaultMode, position, onShare, onExport],
  );

  const contextValue = useMemo(
    () => ({
      session,
      setSession,
      mode,
      setMode,
      userName,
      setUserName,
      activePinId,
      setActivePinId,
      panelOpen,
      setPanelOpen,
      config,
    }),
    [session, mode, userName, activePinId, panelOpen, setUserName, config],
  );

  const activePin = session.pins.find((p) => p.id === activePinId) || null;

  const handleCommentSubmit = useCallback(
    (text: string) => {
      if (!pendingClick || !userName) return;
      const pin = createPin(
        pendingClick.x,
        pendingClick.y,
        text,
        userName,
        pendingClick.elementContext,
      );
      setSession((prev) => ({ ...prev, pins: [...prev.pins, pin] }));
      setActivePinId(pin.id);
      setPendingClick(null);
    },
    [pendingClick, userName],
  );

  const handleNameSubmit = useCallback(
    (name: string) => {
      setUserName(name);
      setShowNamePrompt(false);
    },
    [setUserName],
  );

  return (
    <AnnotateContext.Provider value={contextValue}>
      <style>{KEYFRAMES}</style>

      {mode !== "clean" && (
        <SessionBar onShareClick={() => setShowShareModal(true)} />
      )}

      {mode === "annotate" && <AnnotateIndicator />}

      <div
        ref={surfaceRef}
        onClick={handleSurfaceClick}
        style={{
          position: "relative",
          cursor: mode === "annotate" ? "crosshair" : "default",
          marginRight: panelOpen && mode !== "clean" ? 270 : 0,
          transition: "margin-right .22s cubic-bezier(.4,0,.2,1)",
        }}
      >
        {children}

        {session.pins.map((pin, i) => (
          <Pin key={pin.id} pin={pin} index={i} />
        ))}

        {activePin && mode !== "clean" && <CommentBubble pin={activePin} />}

        {pendingClick && mode === "annotate" && (
          <NewCommentInput
            pendingClick={pendingClick}
            onSubmit={handleCommentSubmit}
            onCancel={() => setPendingClick(null)}
            pinNumber={session.pins.length + 1}
          />
        )}
      </div>

      <FloatingPill />

      <FeedbackPanel />

      {showNamePrompt && <NamePrompt onSubmit={handleNameSubmit} />}

      {showShareModal && (
        <ShareModal onClose={() => setShowShareModal(false)} />
      )}
    </AnnotateContext.Provider>
  );
}
