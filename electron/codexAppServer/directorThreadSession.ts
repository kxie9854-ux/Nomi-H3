import { DIRECTOR_LEGACY_SESSION_KEY, directorSessionKey, normalizeDirectorThreadId } from "./directorThreadMap";

/**
 * Official Codex app-server methods from the installed binary
 * (`codex-cli 0.149.0-alpha.4`, `codex app-server generate-ts` / `generate-json-schema`):
 * - thread/start — create a thread
 * - thread/resume { threadId } — reopen an existing thread so later turn/start appends
 * - thread/read { threadId } — read thread metadata (optional includeTurns)
 *
 * Do not invent method names. Resume is the restore API; read is not required to bind.
 */
export const CODEX_THREAD_START = "thread/start";
export const CODEX_THREAD_RESUME = "thread/resume";
export const CODEX_THREAD_READ = "thread/read";

export type DirectorThreadRpc = {
  start: (params: Record<string, unknown>) => Promise<unknown>;
  resume: (params: Record<string, unknown>) => Promise<unknown>;
  read?: (params: Record<string, unknown>) => Promise<unknown>;
};

export type BindDirectorThreadResult = {
  threadId: string;
  sessionKey: string;
  legacy: boolean;
  reused: boolean;
  resumed: boolean;
  started: boolean;
};

export function readCodexThreadId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const thread = (result as { thread?: unknown }).thread;
  if (!thread || typeof thread !== "object") return null;
  return normalizeDirectorThreadId((thread as { id?: unknown }).id);
}

export function directorThreadStartParams(cwd: string, developerInstructions: string): Record<string, unknown> {
  return {
    cwd,
    developerInstructions,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  };
}

export function directorThreadResumeParams(
  threadId: string,
  cwd: string,
  developerInstructions: string,
): Record<string, unknown> {
  return {
    threadId,
    ...directorThreadStartParams(cwd, developerInstructions),
  };
}

async function startThread(
  rpc: DirectorThreadRpc,
  params: Record<string, unknown>,
): Promise<string> {
  const started = readCodexThreadId(await rpc.start(params));
  if (!started) throw new Error("Codex thread/start 没有返回 thread.id");
  return started;
}

/**
 * Bind one Codex thread to one session key.
 * Missing/unsafe project IDs use the stable legacy key.
 * A failed `thread/resume` drops only that key and calls `thread/start`.
 */
export async function bindDirectorThread(input: {
  projectId: unknown;
  cwd: string;
  developerInstructions: string;
  map: Map<string, string>;
  liveThreadIds: Set<string>;
  persist?: (map: Map<string, string>) => void;
  rpc: DirectorThreadRpc;
}): Promise<BindDirectorThreadResult> {
  const sessionKey = directorSessionKey(input.projectId);
  const legacy = sessionKey === DIRECTOR_LEGACY_SESSION_KEY;
  const startParams = directorThreadStartParams(input.cwd, input.developerInstructions);
  const known = input.map.get(sessionKey);
  const knownThread = known ? normalizeDirectorThreadId(known) : null;

  if (knownThread && input.liveThreadIds.has(knownThread)) {
    return {
      threadId: knownThread,
      sessionKey,
      legacy,
      reused: true,
      resumed: false,
      started: false,
    };
  }

  if (knownThread) {
    if (input.rpc.read) {
      try {
        await input.rpc.read({ threadId: knownThread });
      } catch {
        // thread/read is a probe; thread/resume is the restore gate.
      }
    }
    try {
      const resumed = readCodexThreadId(await input.rpc.resume(
        directorThreadResumeParams(knownThread, input.cwd, input.developerInstructions),
      )) || knownThread;
      input.liveThreadIds.add(resumed);
      if (resumed !== knownThread) {
        input.map.set(sessionKey, resumed);
        input.persist?.(input.map);
      }
      return {
        threadId: resumed,
        sessionKey,
        legacy,
        reused: false,
        resumed: true,
        started: false,
      };
    } catch {
      input.map.delete(sessionKey);
      input.persist?.(input.map);
    }
  }

  const started = await startThread(input.rpc, startParams);
  input.liveThreadIds.add(started);
  input.map.set(sessionKey, started);
  input.persist?.(input.map);
  return {
    threadId: started,
    sessionKey,
    legacy,
    reused: false,
    resumed: false,
    started: true,
  };
}
