import type { WebSocket } from "ws";

export type SessionKind = "parent" | "parallel";

export type SessionSummary = {
  id: string;
  kind: SessionKind;
  sessionId: string | null;
  sessionFile: string | null;
  sessionName: string | null;
  label: string;
  secondaryLabel: string;
  firstUserPreview: string | null;
  lastUserPreview: string | null;
  model: { id: string; name: string; provider: string } | null;
  isRunning: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  messageCount: number;
  pendingMessageCount: number;
  hasPendingUiRequest: boolean;
  lastError: string;
  lastActivityAt: number;
  childPid: number | null;
  cwd?: string | null;
  mirrorsCli?: boolean;
};

export type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type PendingClientResponse = {
  ws: WebSocket;
  responseCommand?: string;
  responseData?: Record<string, unknown>;
  onSuccess?: (payload: any) => void;
  onError?: (payload: any) => void;
};

export type SessionSnapshot = {
  state: any;
  messages: any[];
  commands: any[];
  liveAssistantMessage: any;
  liveTools: any[];
};

export type ClientState = {
  activeSessionId: string | null;
};

export type SessionWorkerOptions<TWorker> = {
  cwd: string;
  send: (ws: WebSocket, payload: unknown) => void;
  onActivity: () => void;
  onStateChange: () => void;
  onEnvelope: (worker: TWorker, envelope: any) => void;
  shouldAutoRestart: (worker: TWorker) => boolean;
};

export type SessionStatus = {
  childRunning: boolean;
  cwd: string;
  previousCwd: string | null;
  isStreaming: boolean;
  isCompacting: boolean;
  lastError: string;
  childPid: number | null;
  sessionWorkerId: string;
  sessionKind: SessionKind;
};

export interface SessionController {
  id: string;
  kind: SessionKind;
  cwd: string;
  previousCwd: string | null;
  currentSessionFile: string | null;
  lastError: string;
  lastActivityAt: number;
  pendingUiRequest: any;
  ensureStarted(startOptions?: { sessionFile?: string | null }): Promise<void>;
  request(command: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  refreshCachedSnapshot(timeoutMs?: number): Promise<SessionSnapshot>;
  getSnapshot(): Promise<SessionSnapshot>;
  sendClientCommand(command: Record<string, unknown>, meta?: PendingClientResponse): Promise<string | undefined>;
  reload(): Promise<void>;
  dispose(): Promise<void>;
  getStatus(): SessionStatus;
  getSummary(): SessionSummary;
  getCachedSnapshot(): SessionSnapshot;
  setTrackedCwd?(cwd: string, previousCwd?: string | null): void;
}

export type PhoneSessionPoolOptions = {
  cwd: string;
  send: (ws: WebSocket, payload: unknown) => void;
  onActivity: () => void;
  buildStatusMeta: () => Record<string, unknown>;
  createDefaultSession: () => SessionController;
  createParallelSession: (sessionFile?: string | null) => SessionController;
};
