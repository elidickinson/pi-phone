import type { WebSocket } from "ws";
import type {
  ClientState,
  PhoneSessionPoolOptions,
  SessionController,
  SessionSnapshot,
  SessionSummary,
} from "./types";

export class PhoneSessionPool {
  private readonly options: PhoneSessionPoolOptions;
  private readonly workers = new Map<string, SessionController>();
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly statusSignatures = new Map<WebSocket, string>();
  private readonly catalogSignatures = new Map<WebSocket, string>();
  private defaultWorkerId: string | null = null;
  private defaultWorkerPromise: Promise<SessionController> | null = null;

  constructor(options: PhoneSessionPoolOptions) {
    this.options = options;
  }

  setCwd(cwd: string) {
    this.options.cwd = cwd;
    this.broadcastStatus();
  }

  get clientCount() {
    return this.clients.size;
  }

  getClients() {
    return [...this.clients.keys()];
  }

  getSelectedSessionId() {
    return this.defaultWorkerId;
  }

  getSession(sessionId: string | null | undefined) {
    if (!sessionId) return null;
    return this.workers.get(sessionId) || null;
  }

  getSessions() {
    return [...this.workers.values()];
  }

  private attachSession(session: SessionController) {
    this.workers.set(session.id, session);
    return session;
  }

  private createDefaultSession() {
    const session = this.options.createDefaultSession();
    return this.attachSession(session);
  }

  private createParallelSession(sessionFile: string | null = null) {
    const session = this.options.createParallelSession(sessionFile);
    return this.attachSession(session);
  }

  private sortedWorkers() {
    return [...this.workers.values()].sort((left, right) => right.lastActivityAt - left.lastActivityAt);
  }

  private serializeSessions() {
    return this.sortedWorkers().map((worker) => worker.getSummary());
  }

  async ensureDefaultWorker() {
    const existing = this.defaultWorkerId ? this.workers.get(this.defaultWorkerId) : this.sortedWorkers()[0];
    if (existing) {
      this.defaultWorkerId = existing.id;
      return existing;
    }

    if (this.defaultWorkerPromise) {
      return this.defaultWorkerPromise;
    }

    this.defaultWorkerPromise = (async () => {
      const worker = this.createDefaultSession();
      this.defaultWorkerId = worker.id;

      try {
        await worker.ensureStarted();
        await worker.refreshCachedSnapshot(5000).catch(() => {});
        this.broadcastCatalog();
        this.broadcastStatus();
        return worker;
      } catch (error) {
        this.workers.delete(worker.id);
        if (this.defaultWorkerId === worker.id) {
          this.defaultWorkerId = null;
        }
        throw error;
      }
    })().finally(() => {
      this.defaultWorkerPromise = null;
    });

    return this.defaultWorkerPromise;
  }

  private async getWorkerForClient(ws: WebSocket) {
    const client = this.clients.get(ws);
    if (!client) {
      const worker = await this.ensureDefaultWorker();
      this.clients.set(ws, { activeSessionId: worker.id });
      return worker;
    }

    const activeWorker = client.activeSessionId ? this.workers.get(client.activeSessionId) : null;
    if (activeWorker) {
      return activeWorker;
    }

    const fallback = await this.ensureDefaultWorker();
    client.activeSessionId = fallback.id;
    return fallback;
  }

  async getActiveWorker(ws: WebSocket) {
    return this.getWorkerForClient(ws);
  }

  private buildBaseStatus() {
    const meta = this.options.buildStatusMeta();
    return {
      ...meta,
      connectedClients: this.clients.size,
      sessionCount: this.workers.size,
      isRunning: Boolean((meta as any).serverRunning),
    };
  }

  private normalizeStatusSignature(status: Record<string, unknown>) {
    const { lastActivityAt: _ignored, ...rest } = status;
    return JSON.stringify(rest);
  }

  private normalizeCatalogSignature(data: { activeSessionId: string | null; sessions: SessionSummary[] }) {
    return JSON.stringify({
      activeSessionId: data.activeSessionId,
      sessions: data.sessions.map(({ lastActivityAt: _ignored, ...session }) => session),
    });
  }

  private handleWorkerStateChange(_worker: SessionController) {
    this.broadcastCatalog();
    this.broadcastStatus();
  }

  buildOverallStatus() {
    const worker = this.defaultWorkerId ? this.workers.get(this.defaultWorkerId) : this.sortedWorkers()[0] || null;
    return {
      ...this.buildBaseStatus(),
      ...(worker ? worker.getStatus() : {
        childRunning: false,
        isStreaming: false,
        isCompacting: false,
        lastError: "",
        childPid: null,
        sessionWorkerId: null,
        sessionKind: "parallel",
      }),
    };
  }

  private buildClientStatus(ws: WebSocket) {
    const client = this.clients.get(ws);
    const worker = client?.activeSessionId ? this.workers.get(client.activeSessionId) : null;
    return {
      ...this.buildBaseStatus(),
      ...(worker ? worker.getStatus() : {
        childRunning: false,
        isStreaming: false,
        isCompacting: false,
        lastError: "",
        childPid: null,
        sessionWorkerId: null,
        sessionKind: "parallel",
      }),
      activeSessionId: client?.activeSessionId || null,
    };
  }

  private sendStatus(ws: WebSocket, options: { force?: boolean } = {}) {
    const data = this.buildClientStatus(ws);
    const signature = this.normalizeStatusSignature(data);
    if (!options.force && this.statusSignatures.get(ws) === signature) {
      return;
    }

    this.statusSignatures.set(ws, signature);
    this.options.send(ws, { channel: "server", event: "status", data });
  }

  private sendSnapshot(ws: WebSocket, worker: SessionController, snapshot: SessionSnapshot) {
    this.options.send(ws, {
      channel: "snapshot",
      sessionWorkerId: worker.id,
      state: snapshot.state,
      messages: snapshot.messages || [],
      commands: snapshot.commands || [],
      liveAssistantMessage: snapshot.liveAssistantMessage || null,
      liveTools: snapshot.liveTools || [],
    });
  }

  broadcastStatus() {
    for (const ws of this.clients.keys()) {
      this.sendStatus(ws);
    }
  }

  sendCatalog(ws: WebSocket, options: { force?: boolean } = {}) {
    const client = this.clients.get(ws);
    const data = {
      activeSessionId: client?.activeSessionId || null,
      sessions: this.serializeSessions(),
    };
    const signature = this.normalizeCatalogSignature(data);
    if (!options.force && this.catalogSignatures.get(ws) === signature) {
      return;
    }

    this.catalogSignatures.set(ws, signature);
    this.options.send(ws, {
      channel: "sessions",
      event: "catalog",
      data,
    });
  }

  broadcastCatalog() {
    for (const ws of this.clients.keys()) {
      this.sendCatalog(ws);
    }
  }

  private forwardEnvelope(worker: SessionController, envelope: any) {
    for (const [ws, client] of this.clients.entries()) {
      if (client.activeSessionId === worker.id) {
        this.options.send(ws, envelope);
      }
    }
  }

  async addClient(ws: WebSocket) {
    const worker = await this.ensureDefaultWorker();
    this.clients.set(ws, { activeSessionId: this.defaultWorkerId || worker.id });
    this.sendStatus(ws, { force: true });
    this.sendCatalog(ws, { force: true });
    await this.refreshActiveSnapshot(ws);
  }

  removeClient(ws: WebSocket) {
    this.clients.delete(ws);
    this.statusSignatures.delete(ws);
    this.catalogSignatures.delete(ws);
    this.broadcastStatus();
  }

  async refreshActiveSnapshot(ws: WebSocket) {
    const worker = await this.getWorkerForClient(ws);
    const requestedWorkerId = worker.id;

    try {
      const snapshot = await worker.getSnapshot();
      const client = this.clients.get(ws);
      if (client?.activeSessionId !== requestedWorkerId) {
        return;
      }

      this.sendSnapshot(ws, worker, snapshot);
      this.sendStatus(ws);
      if (worker.pendingUiRequest) {
        this.options.send(ws, { channel: "rpc", payload: worker.pendingUiRequest });
      }
    } catch (error) {
      const client = this.clients.get(ws);
      if (client?.activeSessionId !== requestedWorkerId) {
        return;
      }

      this.options.send(ws, {
        channel: "server",
        event: "snapshot-error",
        data: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async broadcastSnapshots() {
    await Promise.all(this.getClients().map(async (ws) => this.refreshActiveSnapshot(ws)));
  }

  async selectSession(ws: WebSocket, sessionId: string) {
    const worker = this.workers.get(sessionId);
    if (!worker) {
      this.options.send(ws, { channel: "server", event: "client-error", data: { message: "That session no longer exists." } });
      return;
    }

    const client = this.clients.get(ws);
    if (!client) {
      this.clients.set(ws, { activeSessionId: sessionId });
    } else {
      client.activeSessionId = sessionId;
    }

    this.defaultWorkerId = worker.id;

    this.sendCatalog(ws, { force: true });
    this.sendStatus(ws, { force: true });
    this.sendSnapshot(ws, worker, worker.getCachedSnapshot());
    await this.refreshActiveSnapshot(ws);
  }

  async spawnSession(ws: WebSocket, sessionFile: string | null = null) {
    const worker = this.createParallelSession(sessionFile);
    let added = false;
    const existingClient = this.clients.get(ws);
    const previousActiveSessionId = existingClient?.activeSessionId || null;

    try {
      added = true;
      this.defaultWorkerId = worker.id;

      if (existingClient) {
        existingClient.activeSessionId = worker.id;
      } else {
        this.clients.set(ws, { activeSessionId: worker.id });
      }

      this.sendCatalog(ws, { force: true });
      this.sendStatus(ws, { force: true });
      this.sendSnapshot(ws, worker, worker.getCachedSnapshot());

      await worker.ensureStarted();
      await worker.refreshCachedSnapshot(5000).catch(() => {});
      this.broadcastCatalog();
      this.broadcastStatus();
      await this.refreshActiveSnapshot(ws);
      return worker;
    } catch (error) {
      if (added) {
        this.workers.delete(worker.id);
      }
      const fallbackWorker = previousActiveSessionId ? this.workers.get(previousActiveSessionId) : this.sortedWorkers()[0] || null;
      if (this.defaultWorkerId === worker.id) {
        this.defaultWorkerId = fallbackWorker?.id || null;
      }

      const client = this.clients.get(ws);
      if (client) {
        client.activeSessionId = fallbackWorker?.id || null;
      }

      await worker.dispose().catch(() => {});
      this.sendCatalog(ws, { force: true });
      this.sendStatus(ws, { force: true });
      if (fallbackWorker) {
        this.sendSnapshot(ws, fallbackWorker, fallbackWorker.getCachedSnapshot());
        await this.refreshActiveSnapshot(ws).catch(() => {});
      }
      this.broadcastCatalog();
      this.broadcastStatus();
      throw error;
    }
  }

  async removeSession(sessionId: string, options: { dispose?: boolean; fallbackSessionId?: string | null } = {}) {
    const worker = this.workers.get(sessionId);
    if (!worker) return false;

    const { dispose = true } = options;
    this.workers.delete(sessionId);

    let fallbackWorker = options.fallbackSessionId ? this.workers.get(options.fallbackSessionId) || null : null;
    if (!fallbackWorker) {
      fallbackWorker = this.defaultWorkerId && this.defaultWorkerId !== sessionId
        ? this.workers.get(this.defaultWorkerId) || null
        : null;
    }
    if (!fallbackWorker) {
      fallbackWorker = this.sortedWorkers()[0] || null;
    }

    if (this.defaultWorkerId === sessionId) {
      this.defaultWorkerId = fallbackWorker?.id || null;
    }

    for (const client of this.clients.values()) {
      if (client.activeSessionId === sessionId) {
        client.activeSessionId = fallbackWorker?.id || null;
      }
    }

    if (dispose) {
      await worker.dispose().catch(() => {});
    }

    this.broadcastCatalog();
    this.broadcastStatus();
    await Promise.all(this.getClients().map(async (ws) => {
      const client = this.clients.get(ws);
      if (!client?.activeSessionId) return;
      await this.refreshActiveSnapshot(ws).catch(() => {});
    }));

    return true;
  }

  setDefaultWorker(sessionId: string | null) {
    this.defaultWorkerId = sessionId && this.workers.has(sessionId) ? sessionId : this.sortedWorkers()[0]?.id || null;
    for (const client of this.clients.values()) {
      if (!client.activeSessionId || !this.workers.has(client.activeSessionId)) {
        client.activeSessionId = this.defaultWorkerId;
      }
    }
    this.broadcastCatalog();
    this.broadcastStatus();
  }

  bindExternalSession(session: SessionController) {
    this.attachSession(session);
    if (!this.defaultWorkerId) {
      this.defaultWorkerId = session.id;
    }
  }

  notifySessionStateChanged(session: SessionController) {
    this.handleWorkerStateChange(session);
  }

  forwardSessionEnvelope(session: SessionController, envelope: any) {
    this.forwardEnvelope(session, envelope);
  }

  async closeAllClients(options: { payload?: unknown; code?: number; reason?: string } = {}) {
    const { payload, code = 1000, reason = "closing" } = options;
    const sockets = this.getClients();
    this.clients.clear();
    this.statusSignatures.clear();
    this.catalogSignatures.clear();

    for (const ws of sockets) {
      if (payload) {
        this.options.send(ws, payload);
      }
      try {
        ws.close(code, reason);
      } catch {
        // ignore
      }
    }
  }

  async dispose() {
    await this.closeAllClients();
    await Promise.all([...this.workers.values()].map(async (worker) => worker.dispose().catch(() => {})));
    this.workers.clear();
    this.defaultWorkerId = null;
    this.defaultWorkerPromise = null;
  }
}
