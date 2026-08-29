import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DIRECTOR_LEGACY_SESSION_KEY, directorThreadMapPath } from "./directorThreadMap";
import { CODEX_THREAD_READ, CODEX_THREAD_RESUME, CODEX_THREAD_START } from "./directorThreadSession";
import {
  CodexAppServerHost,
  type CodexRpc,
  codexInitializeCapabilities,
  inferNomiElicitationPurpose,
  isCodexAlreadyInitializedError,
  isCodexInternalStderr,
  isCodexNomiToolApproval,
  nomiElicitationAccept,
  parseCodexModelList,
  readNomiSpendApprovalPasses,
  readNomiSpendApprovalScope,
} from "./host";
import { wrapDirectorUserText } from "./directorUserText";

const tempDirs: string[] = [];

function tempSettingsRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-codex-host-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fakeHostRpc(options?: {
  dead?: Set<string>;
  history?: Record<string, unknown>;
  failHistory?: boolean | string;
}) {
  let seq = 0;
  const calls: Array<{ method: string; params?: unknown }> = [];
  const dead = options?.dead || new Set<string>();
  const rpc: CodexRpc = async (method, params) => {
    calls.push({ method, params });
    if (method === CODEX_THREAD_START) {
      seq += 1;
      return { thread: { id: `thread-${seq}` } };
    }
    if (method === CODEX_THREAD_READ) {
      const record = (params || {}) as { threadId?: unknown; includeTurns?: unknown };
      const threadId = String(record.threadId || "");
      if (record.includeTurns === true) {
        if (options?.failHistory) {
          throw new Error(typeof options.failHistory === "string" ? options.failHistory : "includeTurns not supported");
        }
        if (options?.history && Object.prototype.hasOwnProperty.call(options.history, threadId)) {
          return options.history[threadId];
        }
        return { thread: { id: threadId, turns: [] } };
      }
      if (dead.has(threadId)) throw new Error("no rollout found");
      return { thread: { id: threadId } };
    }
    if (method === CODEX_THREAD_RESUME) {
      const threadId = String((params as { threadId?: unknown } | undefined)?.threadId || "");
      if (dead.has(threadId)) throw new Error("no rollout found");
      return { thread: { id: threadId } };
    }
    if (method === "turn/start") return { turn: { id: "turn-1" } };
    return {};
  };
  return { rpc, calls };
}

async function readyHost(settingsRoot: string, rpc: CodexRpc): Promise<CodexAppServerHost> {
  const host = new CodexAppServerHost({ settingsRoot, rpc });
  await host.ensure("/director", "/skills");
  return host;
}

describe("isCodexAlreadyInitializedError", () => {
  it("matches Codex app-server's initialize-once rejection", () => {
    expect(isCodexAlreadyInitializedError(new Error("Already initialized"))).toBe(true);
    expect(isCodexAlreadyInitializedError("Error: already initialized")).toBe(true);
    expect(isCodexAlreadyInitializedError(new Error("Codex thread is not ready"))).toBe(false);
  });
});

describe("isCodexInternalStderr", () => {
  it("hides the models-manager child-exit timeout", () => {
    expect(isCodexInternalStderr(
      "2026-08-22T14:53:08.014651Z ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit",
    )).toBe(true);
    expect(isCodexInternalStderr("找不到 Codex。请安装 ChatGPT 桌面版")).toBe(false);
  });

  it("hides structured Rust warnings but keeps real user-facing errors", () => {
    const warning = JSON.stringify({
      timestamp: "2026-08-23T15:00:00Z",
      level: "WARN",
      fields: { message: "ignoring interface.icon_small" },
    });
    expect(isCodexInternalStderr(warning)).toBe(true);
    expect(isCodexInternalStderr(`${warning}\n${warning}`)).toBe(true);
    expect(isCodexInternalStderr(`${warning} ${warning}`)).toBe(true);
    expect(isCodexInternalStderr(JSON.stringify({ message: "登录已失效" }))).toBe(false);
  });

  it("hides only the optional MCP transport startup failure among structured errors", () => {
    const context7StartupFailure = JSON.stringify({
      timestamp: "2026-08-24T16:27:49.174382Z",
      level: "ERROR",
      fields: {
        message: "worker quit with fatal: Client error: HTTP request failed: http/request failed: error sending request for url (https://mcp.context7.com/mcp), when send initialized notification",
      },
      target: "rmcp::transport::worker",
    });
    expect(isCodexInternalStderr(context7StartupFailure)).toBe(true);
    expect(isCodexInternalStderr(JSON.stringify({
      timestamp: "2026-08-24T16:27:49.174382Z",
      level: "ERROR",
      fields: { message: "authentication failed" },
      target: "rmcp::transport::worker",
    }))).toBe(false);
    expect(isCodexInternalStderr(JSON.stringify({
      timestamp: "2026-08-24T16:27:49.174382Z",
      level: "ERROR",
      fields: { message: "worker quit with fatal: HTTP request failed" },
      target: "nomi::generation",
    }))).toBe(false);
  });
});

describe("Codex MCP elicitation capability", () => {
  it("declares both the current extension and legacy compatibility flag", () => {
    expect(codexInitializeCapabilities()).toMatchObject({
      extensions: { "openai/form": {} },
      mcpServerOpenaiFormElicitation: true,
    });
  });

  it("separates Codex transport approval from Nomi product confirmation", () => {
    expect(isCodexNomiToolApproval({ message: 'Allow the nomi MCP server to run tool "nomi_add_nodes"?' })).toBe(true);
    expect(isCodexNomiToolApproval({ message: "即将消耗模型额度，继续吗？" })).toBe(false);
    expect(inferNomiElicitationPurpose({ message: "即将消耗模型额度，继续吗？" })).toBe("spend");
    expect(inferNomiElicitationPurpose({ message: "AI 想在画布落一套方案，继续吗？" })).toBe("action");
    expect(readNomiSpendApprovalScope({ _meta: { nomiSpendApprovalScope: "p1\0v\0m" } })).toBe("p1\0v\0m");
    expect(readNomiSpendApprovalPasses({ _meta: { nomiSpendApprovalPasses: 20 } })).toBe(20);
  });

  it("waits for the panel response before accepting a Nomi spend request", () => {
    const host = new CodexAppServerHost();
    const writes: unknown[] = [];
    const events: unknown[] = [];
    const internals = host as unknown as {
      write: (value: unknown) => void;
      handleServerRequest: (message: unknown) => void;
    };
    internals.write = (value) => writes.push(value);
    host.onEvent((event) => events.push(event));
    internals.handleServerRequest({
      id: 41,
      method: "mcpServer/elicitation/request",
      params: {
        serverName: "nomi",
        message: "确认消耗模型额度吗？",
        _meta: { nomiSpendApprovalScope: "p1\0v\0m", nomiSpendApprovalPasses: 20 },
        requestedSchema: { properties: { confirm: { type: "boolean" } }, required: ["confirm"] },
      },
    });
    expect(writes).toHaveLength(0);
    expect(events).toContainEqual({
      kind: "elicitation",
      requestId: "41",
      message: "确认消耗模型额度吗？",
      purpose: "spend",
      approvalScope: "p1\0v\0m",
      approvalPasses: 20,
    });
    expect(host.respondElicitation("41", true)).toBe(true);
    expect(writes).toContainEqual(expect.objectContaining({ id: 41, result: { action: "accept", content: { confirm: true } } }));
    expect(host.respondElicitation("41", true)).toBe(false);
  });
});

describe("nomiElicitationAccept", () => {
  it("sets confirm=true so Nomi spend elicitation actually proceeds", () => {
    expect(nomiElicitationAccept({
      serverName: "nomi",
      requestedSchema: {
        type: "object",
        properties: { confirm: { type: "boolean", title: "确认生成" } },
        required: ["confirm"],
      },
    })).toEqual({ action: "accept", content: { confirm: true } });
  });
});

describe("project-scoped director threads", () => {
  it("gives A and B different threads and reuses A after switching back", async () => {
    const { rpc, calls } = fakeHostRpc();
    const host = await readyHost(tempSettingsRoot(), rpc);
    await host.send("idea a", "/skill.md", "project-a");
    await host.send("idea b", "/skill.md", "project-b");
    await host.send("again a", "/skill.md", "project-a");
    expect(host.directorThreadBindings()).toEqual({
      "project-a": "thread-1",
      "project-b": "thread-2",
    });
    const turns = calls.filter((call) => call.method === "turn/start");
    expect(turns).toHaveLength(3);
    expect(turns[0]?.params).toMatchObject({ threadId: "thread-1" });
    expect(turns[1]?.params).toMatchObject({ threadId: "thread-2" });
    expect(turns[2]?.params).toMatchObject({ threadId: "thread-1" });
    expect(calls.filter((call) => call.method === CODEX_THREAD_START)).toHaveLength(2);
  });

  it("sends no skill item in none mode", async () => {
    const { rpc, calls } = fakeHostRpc();
    const host = await readyHost(tempSettingsRoot(), rpc);
    await host.send("idea", null, "project-a");
    const turn = calls.find((call) => call.method === "turn/start");
    expect(turn?.params).toMatchObject({
      input: [{ type: "text", text: "idea" }],
    });
  });

  it("attaches overlay skills after the H3 spine", async () => {
    const { rpc, calls } = fakeHostRpc();
    const host = await readyHost(tempSettingsRoot(), rpc);
    await host.send("idea", "/skill.md", "project-a", [{ name: "director.guzhuang", path: "/guzhuang.md" }]);
    const turn = calls.find((call) => call.method === "turn/start");
    expect(turn?.params).toMatchObject({
      input: [
        { type: "skill", name: "h3-autodl-art-director", path: "/skill.md" },
        { type: "skill", name: "director.guzhuang", path: "/guzhuang.md" },
        { type: "text", text: "idea" },
      ],
    });
  });

  it("rebuilds a host from the injected settings-root mapping and resumes A", async () => {
    const settingsRoot = tempSettingsRoot();
    const first = fakeHostRpc();
    const host1 = await readyHost(settingsRoot, first.rpc);
    await host1.send("idea a", "/skill.md", "project-a");
    await host1.send("idea b", "/skill.md", "project-b");

    const second = fakeHostRpc();
    const host2 = await readyHost(settingsRoot, second.rpc);
    await host2.send("continue a", "/skill.md", "project-a");
    expect(host2.directorThreadBindings()).toEqual({
      "project-a": "thread-1",
      "project-b": "thread-2",
    });
    expect(second.calls.some((call) => call.method === CODEX_THREAD_RESUME && (call.params as { threadId?: string }).threadId === "thread-1")).toBe(true);
    expect(second.calls.filter((call) => call.method === CODEX_THREAD_START)).toHaveLength(0);
    expect(second.calls.find((call) => call.method === "turn/start")?.params).toMatchObject({ threadId: "thread-1" });
  });

  it("rebuilds only the unusable project thread and leaves B mapped", async () => {
    const settingsRoot = tempSettingsRoot();
    const first = fakeHostRpc();
    const host1 = await readyHost(settingsRoot, first.rpc);
    await host1.send("idea a", "/skill.md", "project-a");
    await host1.send("idea b", "/skill.md", "project-b");

    const second = fakeHostRpc({ dead: new Set(["thread-1"]) });
    const host2 = await readyHost(settingsRoot, second.rpc);
    await host2.send("retry a", "/skill.md", "project-a");
    await host2.send("continue b", "/skill.md", "project-b");
    expect(host2.directorThreadBindings()).toEqual({
      "project-a": "thread-1",
      "project-b": "thread-2",
    });
    expect(second.calls.filter((call) => call.method === CODEX_THREAD_START)).toHaveLength(1);
    const turns = second.calls.filter((call) => call.method === "turn/start");
    expect(turns[0]?.params).toMatchObject({ threadId: "thread-1" });
    expect(turns[1]?.params).toMatchObject({ threadId: "thread-2" });
  });

  it("tags streamed events with the project bound to their thread", async () => {
    const settingsRoot = tempSettingsRoot();
    const { rpc } = fakeHostRpc();
    const host = await readyHost(settingsRoot, rpc);
    await host.send("A", "/skill.md", "project-a");
    await host.send("B", "/skill.md", "project-b");
    const events: unknown[] = [];
    host.onEvent((event) => events.push(event));

    const internals = host as unknown as { handleNotification: (message: unknown) => void };
    internals.handleNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", delta: "A only" },
    });
    internals.handleNotification({
      method: "turn/completed",
      params: { threadId: "thread-2" },
    });

    expect(events).toEqual([
      { kind: "delta", text: "A only", projectId: "project-a" },
      { kind: "turn-complete", projectId: "project-b" },
    ]);
  });

  it("uses a stable legacy key when projectId is omitted, and never persists elicitation or turn state", async () => {
    const settingsRoot = tempSettingsRoot();
    const { rpc } = fakeHostRpc();
    const host = await readyHost(settingsRoot, rpc);
    const internals = host as unknown as {
      write: (value: unknown) => void;
      handleServerRequest: (message: unknown) => void;
      pendingElicitations: Map<string, unknown>;
    };
    internals.write = () => undefined;
    internals.handleServerRequest({
      id: 9,
      method: "mcpServer/elicitation/request",
      params: {
        serverName: "nomi",
        message: "确认消耗模型额度吗？",
        requestedSchema: { properties: { confirm: { type: "boolean" } }, required: ["confirm"] },
      },
    });
    expect(internals.pendingElicitations.size).toBe(1);

    await host.send("no project", "/skill.md");
    const filePath = directorThreadMapPath(settingsRoot);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    expect(raw).toEqual({
      version: 1,
      threads: { [DIRECTOR_LEGACY_SESSION_KEY]: "thread-1" },
    });
    expect(raw).not.toHaveProperty("elicitation");
    expect(raw).not.toHaveProperty("spend");
    expect(raw).not.toHaveProperty("grant");
    expect(raw).not.toHaveProperty("turn");
    expect(host.directorThreadBindings()).toEqual({ [DIRECTOR_LEGACY_SESSION_KEY]: "thread-1" });

    const restored = fakeHostRpc();
    const host2 = await readyHost(settingsRoot, restored.rpc);
    expect(host2.directorThreadBindings()).toEqual({ [DIRECTOR_LEGACY_SESSION_KEY]: "thread-1" });
    const host2Internals = host2 as unknown as { pendingElicitations: Map<string, unknown> };
    expect(host2Internals.pendingElicitations.size).toBe(0);
    expect(host2.respondElicitation("9", true)).toBe(false);
  });

  it("does not persist path-like project ids as map keys or files", async () => {
    const settingsRoot = tempSettingsRoot();
    const { rpc } = fakeHostRpc();
    const host = await readyHost(settingsRoot, rpc);
    await host.send("escape", "/skill.md", "../etc/passwd");
    const raw = JSON.parse(fs.readFileSync(directorThreadMapPath(settingsRoot), "utf8")) as {
      threads: Record<string, string>;
    };
    expect(raw.threads).toEqual({ [DIRECTOR_LEGACY_SESSION_KEY]: "thread-1" });
    expect(raw.threads).not.toHaveProperty("../etc/passwd");
    expect(fs.existsSync(path.resolve(settingsRoot, "..", "etc", "passwd"))).toBe(false);
  });
});

describe("turn/start model and effort overrides", () => {
  it("includes model and effort on turn/start when both are set", async () => {
    const { rpc, calls } = fakeHostRpc();
    const host = await readyHost(tempSettingsRoot(), rpc);
    await host.send("idea", "/skill.md", "project-a", [], { model: "gpt-5.4", effort: "high" });
    const turn = calls.find((call) => call.method === "turn/start");
    expect(turn?.params).toMatchObject({
      threadId: "thread-1",
      model: "gpt-5.4",
      effort: "high",
    });
  });

  it("omits model and effort keys when the user has not picked them", async () => {
    const { rpc, calls } = fakeHostRpc();
    const host = await readyHost(tempSettingsRoot(), rpc);
    await host.send("idea", "/skill.md", "project-a");
    const params = calls.find((call) => call.method === "turn/start")?.params as Record<string, unknown>;
    expect(params).toMatchObject({ threadId: "thread-1" });
    expect(params).not.toHaveProperty("model");
    expect(params).not.toHaveProperty("effort");
  });

  it("trims blanks and omits whitespace-only overrides", async () => {
    const { rpc, calls } = fakeHostRpc();
    const host = await readyHost(tempSettingsRoot(), rpc);
    await host.send("idea", "/skill.md", "project-a", [], { model: "  ", effort: "   " });
    const params = calls.find((call) => call.method === "turn/start")?.params as Record<string, unknown>;
    expect(params).not.toHaveProperty("model");
    expect(params).not.toHaveProperty("effort");
  });
});

describe("listModels", () => {
  it("filters hidden rows and maps the DTO", async () => {
    const rpc: CodexRpc = async (method) => {
      if (method !== "model/list") return {};
      return {
        data: [
          {
            id: "gpt-5.4",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Fast" },
              { reasoningEffort: "medium", description: "Default" },
              { reasoningEffort: "high", description: "Deep" },
            ],
          },
          {
            id: "hidden-model",
            model: "hidden-model",
            displayName: "Hidden",
            hidden: true,
            isDefault: false,
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [],
          },
        ],
      };
    };
    const host = await readyHost(tempSettingsRoot(), rpc);
    await expect(host.listModels()).resolves.toEqual([
      {
        id: "gpt-5.4",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Fast" },
          { reasoningEffort: "medium", description: "Default" },
          { reasoningEffort: "high", description: "Deep" },
        ],
      },
    ]);
  });

  it("returns [] when model/list fails so the director still works", async () => {
    const rpc: CodexRpc = async (method) => {
      if (method === "model/list") throw new Error("codex_models_manager timeout waiting for child process to exit");
      return {};
    };
    const host = await readyHost(tempSettingsRoot(), rpc);
    await expect(host.listModels()).resolves.toEqual([]);
    expect(parseCodexModelList(null)).toEqual([]);
  });
});

describe("read-only project director history", () => {
  it("returns empty for an unbound project without any thread RPC", async () => {
    const fake = fakeHostRpc();
    const host = await readyHost(tempSettingsRoot(), fake.rpc);

    await expect(host.readDirectorHistory("project-missing")).resolves.toEqual({
      projectId: "project-missing",
      threadId: null,
      lines: [],
      truncated: false,
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("reads A and B only from their persisted threads with includeTurns", async () => {
    const settingsRoot = tempSettingsRoot();
    const initial = fakeHostRpc();
    const first = await readyHost(settingsRoot, initial.rpc);
    await first.send("seed a", "/skill.md", "project-a");
    await first.send("seed b", "/skill.md", "project-b");

    const restored = fakeHostRpc({
      history: {
        "thread-1": {
          thread: {
            id: "thread-1",
            turns: [{
              id: "turn-a",
              items: [
                { id: "ua", type: "userMessage", content: [{ type: "text", text: wrapDirectorUserText("只属于 A", "project-a") }] },
                { id: "aa", type: "agentMessage", text: "A 的回复" },
              ],
            }],
          },
        },
        "thread-2": {
          thread: {
            id: "thread-2",
            turns: [{
              id: "turn-b",
              items: [
                { id: "ub", type: "userMessage", content: [{ type: "text", text: wrapDirectorUserText("只属于 B", "project-b") }] },
              ],
            }],
          },
        },
      },
    });
    const second = await readyHost(settingsRoot, restored.rpc);

    const [a, b] = await Promise.all([
      second.readDirectorHistory("project-a"),
      second.readDirectorHistory("project-b"),
    ]);
    expect(a.lines.map((line) => line.text)).toEqual(["只属于 A", "A 的回复"]);
    expect(b.lines.map((line) => line.text)).toEqual(["只属于 B"]);
    expect(JSON.stringify(a)).not.toContain("project-b");
    expect(JSON.stringify(b)).not.toContain("project-a");
    expect(restored.calls.filter((call) => call.method === CODEX_THREAD_READ)).toEqual([
      { method: CODEX_THREAD_READ, params: { threadId: "thread-1", includeTurns: true } },
      { method: CODEX_THREAD_READ, params: { threadId: "thread-2", includeTurns: true } },
    ]);
    expect(restored.calls.some((call) => call.method === CODEX_THREAD_START || call.method === CODEX_THREAD_RESUME)).toBe(false);
  });

  it("keeps the binding usable for send after a history read failure", async () => {
    const settingsRoot = tempSettingsRoot();
    const initial = fakeHostRpc();
    const first = await readyHost(settingsRoot, initial.rpc);
    await first.send("seed", "/skill.md", "project-a");

    const restored = fakeHostRpc({ failHistory: "old schema" });
    const second = await readyHost(settingsRoot, restored.rpc);
    await expect(second.readDirectorHistory("project-a")).rejects.toThrow("old schema");
    expect(second.directorThreadBindings()).toEqual({ "project-a": "thread-1" });

    await second.send("continue", "/skill.md", "project-a");
    expect(second.directorThreadBindings()).toEqual({ "project-a": "thread-1" });
    expect(restored.calls.some((call) => call.method === CODEX_THREAD_RESUME)).toBe(true);
    expect(restored.calls.some((call) => call.method === "turn/start"
      && (call.params as { threadId?: string }).threadId === "thread-1")).toBe(true);
    expect(restored.calls.some((call) => call.method === CODEX_THREAD_START)).toBe(false);
  });
});
