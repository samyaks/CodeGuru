export interface SSEProgressMessage {
  type: 'progress';
  phase: string;
  message?: string;
  [key: string]: unknown;
}

export interface SSECompletedMessage {
  type: 'analysis-completed' | 'review-completed';
  id?: string;
  reviewId?: string;
  [key: string]: unknown;
}

export interface SSEErrorMessage {
  type: 'analysis-error' | 'review-error';
  error?: string;
  [key: string]: unknown;
}

export interface SSEConnectedMessage {
  type: 'connected';
  id: string;
}

export interface SSETakeoffMessage {
  // 'product-map-*' events are emitted by `autoCreateProductMap` in the
  // takeoff route; AnalysisProgress waits on them before navigating so
  // the user lands on a populated workspace instead of an empty Map tab.
  // 'context-files-ready' is the analogous event for the
  // generateContextFiles stage.
  type:
    | 'scored'
    | 'complete'
    | 'error'
    | 'status'
    | 'product-map-ready'
    | 'product-map-skipped'
    | 'product-map-failed'
    | 'context-files-ready';
  [key: string]: unknown;
}

export interface SSEDeployMessage {
  type: 'deployed' | 'failed' | 'url-synced';
  [key: string]: unknown;
}

export type SSEMessage =
  | SSEProgressMessage
  | SSECompletedMessage
  | SSEErrorMessage
  | SSEConnectedMessage
  | SSETakeoffMessage
  | SSEDeployMessage;
