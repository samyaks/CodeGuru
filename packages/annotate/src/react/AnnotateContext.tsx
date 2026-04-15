import { createContext, useContext } from "react";
import type { Session, AnnotateMode, AnnotateConfig } from "../core/types";

export interface AnnotateContextType {
  session: Session;
  setSession: React.Dispatch<React.SetStateAction<Session>>;
  mode: AnnotateMode;
  setMode: React.Dispatch<React.SetStateAction<AnnotateMode>>;
  userName: string | null;
  setUserName: (name: string) => void;
  activePinId: string | null;
  setActivePinId: React.Dispatch<React.SetStateAction<string | null>>;
  panelOpen: boolean;
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  config: AnnotateConfig;
}

export const AnnotateContext = createContext<AnnotateContextType | null>(null);

export function useAnnotate(): AnnotateContextType {
  const ctx = useContext(AnnotateContext);
  if (!ctx) {
    throw new Error(
      "useAnnotate must be used inside a <TakeoffAnnotate> provider",
    );
  }
  return ctx;
}
