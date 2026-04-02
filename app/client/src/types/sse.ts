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

export type SSEMessage = SSEProgressMessage | SSECompletedMessage | SSEErrorMessage | SSEConnectedMessage;
