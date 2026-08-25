import { describe, expect, it } from "vitest";
import { DIRECTOR_LEGACY_SESSION_KEY } from "./directorThreadMap";
import {
  bindDirectorThread,
  CODEX_THREAD_READ,
  CODEX_THREAD_RESUME,
  CODEX_THREAD_START,
  directorThreadResumeParams,
  readCodexThreadId,
} from "./directorThreadSession";

function fakeRpc(options?: { dead?: Set<string> }) {
  let seq = 0;
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const dead = options?.dead || new Set<string>();
  const lookup = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    const threadId = String(params.threadId || "");
    if (dead.has(threadId)) throw new Error("no rollout found");
    return { thread: { id: threadId } };
  };
  return {
    calls,
    rpc: {
      start: async (params: Record<string, unknown>) => {
        calls.push({ method: CODEX_THREAD_START, params });
        seq += 1;
        return { thread: { id: `thread-${seq}` } };
      },
      resume: async (params: Record<string, unknown>) => lookup(CODEX_THREAD_RESUME, params),
      read: async (params: Record<string, unknown>) => lookup(CODEX_THREAD_READ, params),
    },
  };
}

describe("Codex app-server thread methods", () => {
  it("uses the installed protocol names thread/start, thread/resume, and thread/read", () => {
    expect(CODEX_THREAD_START).toBe("thread/start");
    expect(CODEX_THREAD_RESUME).toBe("thread/resume");
    expect(CODEX_THREAD_READ).toBe("thread/read");
    expect(directorThreadResumeParams("thr_1", "/cwd", "dirs")).toMatchObject({
      threadId: "thr_1",
      cwd: "/cwd",
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    expect(readCodexThreadId({ thread: { id: " thr_1 " } })).toBe("thr_1");
  });
});

describe("bindDirectorThread", () => {
  it("gives A and B different threads and reuses A after switching away", async () => {
    const { rpc, calls } = fakeRpc();
    const map = new Map<string, string>();
    const live = new Set<string>();
    const a = await bindDirectorThread({
      projectId: "project-a",
      cwd: "/director",
      developerInstructions: "dirs",
      map,
      liveThreadIds: live,
      rpc,
    });
    const b = await bindDirectorThread({
      projectId: "project-b",
      cwd: "/director",
      developerInstructions: "dirs",
      map,
      liveThreadIds: live,
      rpc,
    });
    const aAgain = await bindDirectorThread({
      projectId: "project-a",
      cwd: "/director",
      developerInstructions: "dirs",
      map,
      liveThreadIds: live,
      rpc,
    });
    expect(a.threadId).toBe("thread-1");
    expect(b.threadId).toBe("thread-2");
    expect(aAgain).toMatchObject({ threadId: "thread-1", reused: true, started: false, resumed: false });
    expect(map).toEqual(new Map([["project-a", "thread-1"], ["project-b", "thread-2"]]));
    expect(calls.filter((call) => call.method === CODEX_THREAD_START)).toHaveLength(2);
  });

  it("resumes from the persisted mapping after live threads are cleared", async () => {
    const { rpc, calls } = fakeRpc();
    const map = new Map([["project-a", "thread-saved"]]);
    const live = new Set<string>();
    const bound = await bindDirectorThread({
      projectId: "project-a",
      cwd: "/director",
      developerInstructions: "dirs",
      map,
      liveThreadIds: live,
      rpc,
    });
    expect(bound).toMatchObject({ threadId: "thread-saved", resumed: true, started: false });
    expect(calls.map((call) => call.method)).toEqual([CODEX_THREAD_READ, CODEX_THREAD_RESUME]);
    expect(calls[1]).toMatchObject({
      method: CODEX_THREAD_RESUME,
      params: { threadId: "thread-saved" },
    });
  });

  it("rebuilds only the unusable project thread and leaves the other mapping", async () => {
    const { rpc } = fakeRpc({ dead: new Set(["thread-dead"]) });
    const map = new Map([["project-a", "thread-dead"], ["project-b", "thread-b"]]);
    const live = new Set<string>();
    const a = await bindDirectorThread({
      projectId: "project-a",
      cwd: "/director",
      developerInstructions: "dirs",
      map,
      liveThreadIds: live,
      rpc,
    });
    const b = await bindDirectorThread({
      projectId: "project-b",
      cwd: "/director",
      developerInstructions: "dirs",
      map,
      liveThreadIds: live,
      rpc,
    });
    expect(a).toMatchObject({ threadId: "thread-1", started: true, sessionKey: "project-a" });
    expect(b).toMatchObject({ threadId: "thread-b", resumed: true });
    expect(map.get("project-a")).toBe("thread-1");
    expect(map.get("project-b")).toBe("thread-b");
  });

  it("uses a stable legacy key for missing or unsafe project ids", async () => {
    const { rpc } = fakeRpc();
    const map = new Map<string, string>();
    const live = new Set<string>();
    const missing = await bindDirectorThread({
      projectId: "",
      cwd: "/director",
      developerInstructions: "dirs",
      map,
      liveThreadIds: live,
      rpc,
    });
    const unsafe = await bindDirectorThread({
      projectId: "../etc/passwd",
      cwd: "/director",
      developerInstructions: "dirs",
      map,
      liveThreadIds: live,
      rpc,
    });
    expect(missing).toMatchObject({
      threadId: "thread-1",
      sessionKey: DIRECTOR_LEGACY_SESSION_KEY,
      legacy: true,
      started: true,
    });
    expect(unsafe).toMatchObject({
      threadId: "thread-1",
      sessionKey: DIRECTOR_LEGACY_SESSION_KEY,
      reused: true,
      legacy: true,
    });
    expect(Object.fromEntries(map)).toEqual({ [DIRECTOR_LEGACY_SESSION_KEY]: "thread-1" });
  });
});
