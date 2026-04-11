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
  type: 'scored' | 'complete' | 'error' | 'status';
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
