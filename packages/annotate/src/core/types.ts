export interface Pin {
  id: string;
  x: number;
  y: number;
  text: string;
  author: string;
  timestamp: number;
  elementContext: ElementContext | null;
  replies: Reply[];
  resolved: boolean;
}

export interface Reply {
  author: string;
  text: string;
  timestamp: number;
}

export interface ElementContext {
  tag: string;
  classes: string[];
  selector: string;
  textContent: string;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

export interface Session {
  id: string;
  name: string;
  created: number;
  pins: Pin[];
}

export type AnnotateMode = "clean" | "review" | "annotate";

export interface AnnotateConfig {
  projectId?: string;
  theme?: "dark" | "light" | "auto";
  defaultMode?: AnnotateMode;
  position?: "bottom-right" | "bottom-left";
  onShare?: (url: string) => void;
  onExport?: (session: Session) => void;
}
