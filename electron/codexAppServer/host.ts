import { spawn, type ChildProcess } from "node:child_process";
import {
  DIRECTOR_LEGACY_SESSION_KEY,
  directorThreadMapPath,
  loadDirectorThreadMap,
  normalizeDirectorProjectId,
  normalizeDirectorThreadId,
  saveDirectorThreadMap,
} from "./directorThreadMap";
import {
  directorThreadReadHistoryParams,
  emptyDirectorHistory,
  inspectDirectorThreadRead,
  limitDirectorHistoryLines,
  type DirectorHistory,
} from "./directorHistory";
import { bindDirectorThread, CODEX_THREAD_READ, CODEX_THREAD_RESUME, CODEX_THREAD_START } from "./directorThreadSession";
import { createNdjsonParser, encodeNdjson, requestFrame, resultFrame, type JsonRpcIncoming } from "./ndjsonRpc";
import { resolveCodexBin } from "./resolveCodexBin";
import { DIRECTOR_SPINE_ID, importedSkillsRoot, skillInputItems, type DirectorSkillRef } from "./directorSkills";
import { codexAppServerEnv } from "./codexEnv";

export type CodexRpc = (method: string, params?: unknown) => Promise<unknown>;
export type CodexAppServerHostOptions = {
  settingsRoot?: string;
  rpc?: CodexRpc;
};

export type CodexAccount = { type: string; email?: string | null; planType?: string | null } | null;

export type CodexReasoningEffortDto = {
  reasoningEffort: string;
  description: string;
};

export type CodexModelDto = {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: CodexReasoningEffortDto[];
};

export type CodexTurnOverride = {
  model?: string;
  effort?: string;
};

function optionalTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Map `model/list` RPC result; drop hidden items; skip malformed rows. */
export function parseCodexModelList(result: unknown): CodexModelDto[] {
  const root = asRecord(result);
  const data = Array.isArray(result)
    ? result
    : Array.isArray(root?.data)
      ? root.data
      : [];
  const out: CodexModelDto[] = [];
  for (const item of data) {
    const rec = asRecord(item);
    if (!rec || rec.hidden === true) continue;
    const model = optionalTrimmedString(rec.model) || optionalTrimmedString(rec.id);
    if (!model) continue;
    const id = optionalTrimmedString(rec.id) || model;
    const displayName = optionalTrimmedString(rec.displayName) || model;
    const defaultReasoningEffort = optionalTrimmedString(rec.defaultReasoningEffort) || null;
    const effortsRaw = Array.isArray(rec.supportedReasoningEfforts) ? rec.supportedReasoningEfforts : [];
    const supportedReasoningEfforts: CodexReasoningEffortDto[] = [];
    for (const effort of effortsRaw) {
      const er = asRecord(effort);
      const reasoningEffort = optionalTrimmedString(er?.reasoningEffort);
      if (!reasoningEffort) continue;
      supportedReasoningEfforts.push({
        reasoningEffort,
        description: optionalTrimmedString(er?.description),
      });
    }
    out.push({
      id,
      model,
      displayName,
      isDefault: rec.isDefault === true,
      defaultReasoningEffort,
      supportedReasoningEfforts,
    });
  }
  return out;
}

export function readCodexTurnOverride(value: unknown): { model: string; effort: string } {
  const rec = asRecord(value) || {};
  return {
    model: optionalTrimmedString(rec.model),
    effort: optionalTrimmedString(rec.effort),
  };
}

export type CodexUiEvent =
  | { kind: "status"; ready: boolean; account: CodexAccount; error?: string }
  | { kind: "delta"; text: string; projectId?: string }
  | { kind: "item"; type: string; text?: string; tool?: string; status?: string; projectId?: string }
  | { kind: "elicitation"; requestId: string; message: string; purpose: "spend" | "action"; approvalScope?: string; approvalPasses?: number; projectId?: string }
  | { kind: "turn-complete"; projectId?: string }
  | { kind: "login-url"; url: string }
  | { kind: "error"; message: string; projectId?: string };

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export function isCodexAlreadyInitializedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already initialized/i.test(message);
}

/** Codex rust tracing on stderr. Not a user-facing failure; app-server keeps serving. */
function isCodexInternalStderrLine(line: string): boolean {
  if (/codex_models_manager/i.test(line)) return true;
  if (/timeout waiting for child process to exit/i.test(line)) return true;
  if (/^\d{4}-\d{2}-\d{2}T\S+Z (INFO|DEBUG|TRACE|WARN)\b/.test(line)) return true;
  try {
    const structured = JSON.parse(line) as {
      timestamp?: unknown;
      level?: unknown;
      fields?: { message?: unknown } | unknown;
      target?: unknown;
    };
    const fields = structured.fields && typeof structured.fields === "object"
      ? structured.fields as { message?: unknown }
      : null;
    const tracingFrame = typeof structured.timestamp === "string" && Boolean(fields);
    if (tracingFrame && /^(INFO|DEBUG|TRACE|WARN)$/i.test(String(structured.level || ""))) return true;
    // An optional MCP server may fail its startup notification while Codex itself remains healthy.
    // Hide only this narrowly identified transport-worker frame; arbitrary structured ERROR output
    // must still reach the user as an actionable failure.
    return tracingFrame
      && /^ERROR$/i.test(String(structured.level || ""))
      && /^rmcp::transport::worker$/i.test(String(structured.target || ""))
      && /worker quit with fatal:.*(?:HTTP request failed|when send initialized notification)/i.test(String(fields?.message || ""));
  } catch {
    return false;
  }
}

export function isCodexInternalStderr(text: string): boolean {
  // Rust tracing may batch JSON frames with either newlines or a single space. Split again at the
  // next structured-frame prefix; a genuine error mixed into the chunk remains a non-internal frame.
  const lines = text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?=\{"timestamp":)/))
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length === 0 || lines.every(isCodexInternalStderrLine);
}

export function nomiElicitationAccept(params: Record<string, unknown>): { action: "accept"; content: Record<string, unknown> } {
  const schema = (params.requestedSchema || {}) as {
    properties?: Record<string, { type?: string; default?: unknown }>;
    required?: string[];
  };
  const content: Record<string, unknown> = {};
  const keys = Array.isArray(schema.required) && schema.required.length
    ? schema.required
    : Object.keys(schema.properties || {});
  for (const key of keys) {
    const prop = schema.properties?.[key];
    if (prop?.type === "boolean" || key === "confirm") content[key] = true;
    else if (prop?.default !== undefined) content[key] = prop.default;
  }
  if (content.confirm === undefined) content.confirm = true;
  return { action: "accept", content };
}

export function codexInitializeCapabilities(): Record<string, unknown> {
  return {
    experimentalApi: true,
    extensions: { "openai/form": {} },
    // Current app-server accepts the extension above; older bundled builds require this legacy flag.
    mcpServerOpenaiFormElicitation: true,
  };
}

export function isCodexNomiToolApproval(params: Record<string, unknown>): boolean {
  return /^Allow the nomi MCP server to run tool "[^"]+"\?$/i.test(String(params.message || "").trim());
}

export function inferNomiElicitationPurpose(params: Record<string, unknown>): "spend" | "action" {
  const text = JSON.stringify({ message: params.message, requestedSchema: params.requestedSchema });
  return /(模型额度|消耗额度|model credits?|spend)/i.test(text) ? "spend" : "action";
}

export function readNomiSpendApprovalScope(params: Record<string, unknown>): string {
  const meta = params._meta && typeof params._meta === "object"
    ? params._meta as Record<string, unknown>
    : {};
  return typeof meta.nomiSpendApprovalScope === "string" ? meta.nomiSpendApprovalScope : "";
}

export function readNomiSpendApprovalPasses(params: Record<string, unknown>): number {
  const meta = params._meta && typeof params._meta === "object"
    ? params._meta as Record<string, unknown>
    : {};
  const passes = Number(meta.nomiSpendApprovalPasses);
  return Number.isInteger(passes) && passes > 0 ? passes : 0;
}

const DIRECTOR_INSTRUCTIONS = [
  "You are the Nomi-H3 canvas director, not a Nomi software engineer.",
  "This session is already inside a running Nomi window. Do not open Nomi, do not wait for cold start, do not run paper radar, and ignore AGENTS.md / CLAUDE.md / docs/research.",
  "Hard vendors: video only autodl-art / autodl-art-h3. Stills only codex-local / codex-imagegen. Never dreamina, never first-frame-only I2VA, never reference video, never nomi_start_playbook.",
  "If the user message names a project id, use ONLY that projectId for nomi_read_canvas / nomi_add_nodes / nomi_generate. Paid submits stay behind Nomi's spend gate.",
  "Every approve/revise/continue gate is a :::choices fence (id | label). Stop that turn.",
  "If a film skill is attached, follow it: stills-first, freeze identity, then nomi_assemble_timeline and nomi_export_timeline. If a skill-author skill is attached, only write and save a director SKILL.md — do not generate stills or H3. If no skill is attached, help on the canvas without forcing the multi-step film spine, still keeping the vendor locks.",
].join(" ");

export class CodexAppServerHost {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly pendingElicitations = new Map<string, { id: string | number; params: Record<string, unknown>; projectId?: string }>();
  /** Threads already started or resumed on the current app-server child. */
  private readonly liveThreadIds = new Set<string>();
  private readonly projectThreads: Map<string, string>;
  private activeTurn: { threadId: string; turnId: string; projectId?: string } | null = null;
  private cwd: string | null = null;
  private settingsRoot: string | null;
  private readonly injectedRpc: CodexRpc | null;
  private account: CodexAccount = null;
  private initialized = false;
  private handshake: Promise<{ account: CodexAccount }> | null = null;
  private extraEnv: Record<string, string> = {};
  private listeners = new Set<(event: CodexUiEvent) => void>();
  private threadLock: Promise<void> = Promise.resolve();

  constructor(options: CodexAppServerHostOptions = {}) {
    this.injectedRpc = options.rpc || null;
    this.settingsRoot = options.settingsRoot || null;
    this.projectThreads = this.settingsRoot
      ? loadDirectorThreadMap(directorThreadMapPath(this.settingsRoot))
      : new Map();
  }

  setSettingsRoot(settingsRoot: string): void {
    this.settingsRoot = settingsRoot;
    const loaded = loadDirectorThreadMap(directorThreadMapPath(settingsRoot));
    this.projectThreads.clear();
    for (const [projectId, threadId] of loaded) this.projectThreads.set(projectId, threadId);
  }

  /** Test/debug: persisted project → thread mapping only. Never includes elicitation, spend, grant, or turn. */
  directorThreadBindings(): Record<string, string> {
    return Object.fromEntries(this.projectThreads);
  }

  setExtraEnv(env: Record<string, string>): void {
    this.extraEnv = env;
  }

  onEvent(listener: (event: CodexUiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CodexUiEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async ensure(cwd: string, skillsRoot: string): Promise<{ account: CodexAccount }> {
    this.cwd = cwd;
    // Serialize all callers (panel mount, StrictMode remount, send) onto one handshake.
    if (this.handshake) return this.handshake;
    this.handshake = this.handshakeOnce(cwd, skillsRoot);
    try {
      return await this.handshake;
    } catch (error) {
      this.handshake = null;
      throw error;
    }
  }

  private async handshakeOnce(cwd: string, skillsRoot: string): Promise<{ account: CodexAccount }> {
    this.cwd = cwd;
    if (this.injectedRpc) {
      this.initialized = true;
      this.emit({ kind: "status", ready: true, account: this.account });
      return { account: this.account };
    }
    if (!this.child) await this.start();
    await this.initializeOnce();
    const accountRes = (await this.request("account/read", {})) as { account?: CodexAccount };
    this.account = accountRes?.account ?? null;
    const extraRoots = [skillsRoot];
    if (this.settingsRoot) {
      try {
        extraRoots.push(importedSkillsRoot(this.settingsRoot));
      } catch {
        /* settings root missing or unsafe — bundled skills still load */
      }
    }
    await this.request("skills/extraRoots/set", { extraRoots });
    this.emit({ kind: "status", ready: true, account: this.account });
    return { account: this.account };
  }

  private async initializeOnce(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.request("initialize", {
        clientInfo: { name: "nomi-h3", version: "0.20.1" },
        capabilities: codexInitializeCapabilities(),
      });
    } catch (error) {
      // Codex app-server allows initialize once per process. Panel ensure() then send()
      // used to hit this; treat it as already-ready, not a hard failure.
      if (!isCodexAlreadyInitializedError(error)) throw error;
    }
    this.write({ method: "initialized", params: {} });
    this.initialized = true;
  }

  async loginChatgpt(): Promise<{ authUrl?: string }> {
    const result = (await this.request("account/login/start", { type: "chatgpt" })) as {
      type?: string;
      authUrl?: string;
    };
    if (result?.authUrl) this.emit({ kind: "login-url", url: result.authUrl });
    return { authUrl: result?.authUrl };
  }

  async send(
    text: string,
    skillPathOrSkills: string | null | readonly DirectorSkillRef[],
    projectId?: string,
    extraSkills: readonly DirectorSkillRef[] = [],
    turn?: CodexTurnOverride,
  ): Promise<void> {
    this.declinePendingElicitationsExcept(normalizeDirectorProjectId(projectId) || undefined);
    const threadId = await this.ensureProjectThread(projectId);
    const safeProjectId = normalizeDirectorProjectId(projectId) || undefined;
    // Establish routing before turn/start resolves: app-server notifications may
    // arrive before the request result under a fast local tool call.
    this.activeTurn = { threadId, turnId: "", ...(safeProjectId ? { projectId: safeProjectId } : {}) };
    const skills = Array.isArray(skillPathOrSkills)
      ? skillPathOrSkills
      : [
          ...(typeof skillPathOrSkills === "string" && skillPathOrSkills
            ? [{ name: DIRECTOR_SPINE_ID, path: skillPathOrSkills }]
            : []),
          ...extraSkills,
        ];
    const override = readCodexTurnOverride(turn);
    const params: Record<string, unknown> = {
      threadId,
      input: [
        ...skillInputItems(skills),
        { type: "text", text },
      ],
    };
    // Omit unset keys so ~/.codex/config.toml model + effort apply.
    if (override.model) params.model = override.model;
    if (override.effort) params.effort = override.effort;
    const started = (await this.request("turn/start", params)) as { turn?: { id?: string } };
    if (typeof started?.turn?.id === "string") {
      this.activeTurn = { threadId, turnId: started.turn.id, ...(safeProjectId ? { projectId: safeProjectId } : {}) };
    }
  }

  /**
   * Read-only visible history for one already-bound project thread.
   * Never start/resume/create a thread. Unsafe/missing/legacy ids return empty.
   */
  async readDirectorHistory(projectId?: unknown): Promise<DirectorHistory> {
    const safeId = normalizeDirectorProjectId(projectId);
    if (!safeId || safeId === DIRECTOR_LEGACY_SESSION_KEY) {
      return emptyDirectorHistory(typeof projectId === "string" ? projectId.trim() : "");
    }
    const threadId = normalizeDirectorThreadId(this.projectThreads.get(safeId) || "");
    if (!threadId) return emptyDirectorHistory(safeId);

    let result: unknown;
    try {
      result = await this.request(CODEX_THREAD_READ, directorThreadReadHistoryParams(threadId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Codex thread/read 失败：${message}`);
    }
    const inspected = inspectDirectorThreadRead(result);
    if (!inspected.ok) throw new Error("Codex thread/read 返回无法识别的结构");
    const limited = limitDirectorHistoryLines(inspected.lines);
    return {
      projectId: safeId,
      threadId,
      lines: limited.lines,
      truncated: limited.truncated,
    };
  }

  /**
   * Visible Codex models for the director picker. RPC failure returns [] so the panel still sends.
   * Hidden rows are dropped even if the server ignored includeHidden: false.
   */
  async listModels(): Promise<CodexModelDto[]> {
    try {
      return parseCodexModelList(await this.request("model/list", { includeHidden: false }));
    } catch {
      return [];
    }
  }

  async interrupt(): Promise<void> {
    if (!this.activeTurn?.turnId) return;
    await this.request("turn/interrupt", {
      threadId: this.activeTurn.threadId,
      turnId: this.activeTurn.turnId,
    });
  }

  private persistProjectThreads(): void {
    if (!this.settingsRoot) return;
    saveDirectorThreadMap(directorThreadMapPath(this.settingsRoot), this.projectThreads);
  }

  private async withThreadLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.threadLock;
    let release!: () => void;
    this.threadLock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      release();
    }
  }

  private async ensureProjectThread(projectId?: string): Promise<string> {
    const cwd = this.cwd;
    if (!cwd) throw new Error("Codex thread is not ready");
    return this.withThreadLock(async () => {
      const bound = await bindDirectorThread({
        projectId,
        cwd,
        developerInstructions: DIRECTOR_INSTRUCTIONS,
        map: this.projectThreads,
        liveThreadIds: this.liveThreadIds,
        persist: () => this.persistProjectThreads(),
        rpc: {
          start: (params) => this.request(CODEX_THREAD_START, params),
          resume: (params) => this.request(CODEX_THREAD_RESUME, params),
          read: (params) => this.request(CODEX_THREAD_READ, { threadId: params.threadId }),
        },
      });
      return bound.threadId;
    });
  }

  respondElicitation(requestId: string, confirmed: boolean): boolean {
    const pending = this.pendingElicitations.get(requestId);
    if (!pending) return false;
    this.pendingElicitations.delete(requestId);
    this.write(resultFrame(
      pending.id,
      confirmed ? nomiElicitationAccept(pending.params) : { action: "decline" },
    ));
    this.emit({
      kind: "item",
      type: "mcp",
      tool: "nomi",
      status: confirmed ? "accepted" : "declined",
      ...(pending.projectId ? { projectId: pending.projectId } : this.activeProjectEventField()),
    });
    return true;
  }

  /** Drop JSON-RPC elicitations that are not for the project about to speak. */
  declinePendingElicitationsExcept(projectId?: string): void {
    for (const requestId of [...this.pendingElicitations.keys()]) {
      const pending = this.pendingElicitations.get(requestId);
      if (!pending) continue;
      if (projectId && pending.projectId === projectId) continue;
      this.respondElicitation(requestId, false);
    }
  }

  status(): { ready: boolean; account: CodexAccount } {
    return { ready: Boolean(this.child), account: this.account };
  }

  async stop(): Promise<void> {
    this.child?.stdin?.end();
    this.child?.kill("SIGTERM");
    this.resetSession();
  }

  private async start(): Promise<void> {
    const bin = resolveCodexBin();
    if (!bin) throw new Error("找不到 Codex。请安装 ChatGPT 桌面版（内含 Codex），或把 codex 放到 PATH。");
    // Client JSON-RPC is NDJSON on stdio. `unix://` is a control socket and closes JSON-RPC clients.
    this.child = spawn(bin, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: codexAppServerEnv(this.extraEnv),
    });
    // Child error/exit owns the real failure; absorb the asynchronous EPIPE echo from stdin.
    this.child.stdin?.on("error", () => {});
    const parse = createNdjsonParser((message) => this.onIncoming(message));
    this.child.stdout?.on("data", parse);
    this.child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (!text || isCodexInternalStderr(text)) return;
      this.emit({ kind: "error", message: text.slice(0, 400) });
    });
    this.child.on("exit", (code) => {
      this.resetSession();
      this.emit({ kind: "status", ready: false, account: this.account, error: `Codex app-server 退出（${code ?? "?"}）` });
    });
  }

  private onIncoming(message: JsonRpcIncoming): void {
    if (message.id !== undefined && this.pending.has(Number(message.id))) {
      const pending = this.pending.get(Number(message.id));
      this.pending.delete(Number(message.id));
      if (message.error) pending?.reject(new Error(message.error.message || "Codex RPC error"));
      else pending?.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }
    this.handleNotification(message);
  }

  private handleServerRequest(message: JsonRpcIncoming): void {
    const method = String(message.method || "");
    const params = (message.params || {}) as Record<string, unknown>;
    if (method === "mcpServer/elicitation/request") {
      const nomi = params.serverName === "nomi";
      if (!nomi) {
        this.write(resultFrame(message.id!, { action: "decline" }));
        return;
      }
      // Codex's own per-tool permission form is not Nomi's human product gate. The embedded director is
      // already confined to the Nomi MCP server; auto-accept this transport permission so plan/spend
      // elicitations issued by Nomi remain the single user-facing confirmations.
      if (isCodexNomiToolApproval(params)) {
        this.write(resultFrame(message.id!, nomiElicitationAccept(params)));
        this.emit({ kind: "item", type: "mcp", tool: "nomi", status: "accepted", ...this.activeProjectEventField() });
        return;
      }
      const requestId = String(message.id);
      const approvalScope = readNomiSpendApprovalScope(params);
      const approvalPasses = readNomiSpendApprovalPasses(params);
      this.pendingElicitations.set(requestId, {
        id: message.id!,
        params,
        ...(this.activeTurn?.projectId ? { projectId: this.activeTurn.projectId } : {}),
      });
      this.emit({
        kind: "elicitation",
        requestId,
        message: typeof params.message === "string" ? params.message : "",
        purpose: inferNomiElicitationPurpose(params),
        ...(approvalScope ? { approvalScope } : {}),
        ...(approvalPasses ? { approvalPasses } : {}),
        ...this.activeProjectEventField(),
      });
      return;
    }
    if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
      this.write(resultFrame(message.id!, { decision: "decline" }));
      this.emit({ kind: "item", type: "approval", tool: String(params.command || "command"), status: "declined", ...this.activeProjectEventField() });
      return;
    }
    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
      this.write(resultFrame(message.id!, { decision: "decline" }));
      return;
    }
    if (method === "item/permissions/requestApproval") {
      this.write(resultFrame(message.id!, { permissions: { network: { enabled: false } }, scope: "session" }));
      return;
    }
    this.emit({ kind: "error", message: `UNHANDLED_CODEX_REQUEST:${method}`, ...this.activeProjectEventField() });
    this.write(resultFrame(message.id!, { decision: "decline" }));
  }

  private handleNotification(message: JsonRpcIncoming): void {
    const method = String(message.method || "");
    const params = (message.params || {}) as Record<string, unknown>;
    const projectField = this.projectEventField(params);
    if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
      this.emit({ kind: "delta", text: params.delta, ...projectField });
      return;
    }
    if (method === "item/completed") {
      const item = (params.item || {}) as {
        type?: string;
        text?: string;
        command?: string;
        server?: string;
        tool?: string;
        status?: string;
        error?: { message?: string } | string;
      };
      const errorText = typeof item.error === "string" ? item.error : item.error?.message;
      this.emit({
        kind: "item",
        type: item.type || method,
        text: item.text || errorText,
        tool: item.tool || item.command || item.server,
        status: item.status,
        ...projectField,
      });
      if (item.status === "failed" && errorText) this.emit({ kind: "error", message: errorText, ...projectField });
      return;
    }
    if (method === "turn/started") {
      const turn = params.turn as { id?: string } | undefined;
      const threadId = typeof (params as { threadId?: unknown }).threadId === "string"
        ? String((params as { threadId?: string }).threadId)
        : this.activeTurn?.threadId;
      if (typeof turn?.id === "string" && threadId) {
        const projectId = this.projectIdForThread(threadId) || this.activeTurn?.projectId;
        this.activeTurn = { threadId, turnId: turn.id, ...(projectId ? { projectId } : {}) };
      }
      return;
    }
    if (method === "turn/completed") {
      const completedProjectField = this.projectEventField(params);
      this.activeTurn = null;
      this.emit({ kind: "turn-complete", ...completedProjectField });
      return;
    }
    if (method === "account/login/completed") {
      void this.request("account/read", {}).then((res) => {
        this.account = (res as { account?: CodexAccount })?.account ?? null;
        this.emit({ kind: "status", ready: true, account: this.account });
      });
      return;
    }
    if (method === "error") {
      const err = params as { message?: string };
      this.emit({ kind: "error", message: String(err.message || "Codex error"), ...projectField });
    }
  }

  private projectIdForThread(threadId: string): string | undefined {
    for (const [projectId, boundThreadId] of this.projectThreads) {
      if (boundThreadId === threadId && projectId !== DIRECTOR_LEGACY_SESSION_KEY) return projectId;
    }
    return undefined;
  }

  private activeProjectEventField(): { projectId?: string } {
    return this.activeTurn?.projectId ? { projectId: this.activeTurn.projectId } : {};
  }

  private projectEventField(params: Record<string, unknown>): { projectId?: string } {
    const threadId = typeof params.threadId === "string" ? params.threadId : this.activeTurn?.threadId;
    const projectId = threadId
      ? this.projectIdForThread(threadId) || (threadId === this.activeTurn?.threadId ? this.activeTurn.projectId : undefined)
      : this.activeTurn?.projectId;
    return projectId ? { projectId } : {};
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    if (this.injectedRpc) return this.injectedRpc(method, params);
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(requestFrame(id, method, params));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Codex RPC 超时：${method}`));
        }
      }, 60_000);
    });
  }

  private write(value: unknown): void {
    this.child?.stdin?.write(encodeNdjson(value));
  }

  private resetSession(): void {
    this.child = null;
    this.activeTurn = null;
    this.liveThreadIds.clear();
    this.initialized = false;
    this.handshake = null;
    for (const pending of this.pending.values()) pending.reject(new Error("Codex app-server 已断开"));
    this.pending.clear();
    this.pendingElicitations.clear();
  }
}

let singleton: CodexAppServerHost | null = null;

export function getCodexAppServerHost(): CodexAppServerHost {
  singleton ??= new CodexAppServerHost();
  return singleton;
}
