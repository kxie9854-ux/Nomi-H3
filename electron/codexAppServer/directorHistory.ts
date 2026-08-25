import { unwrapDirectorUserText } from "./directorUserText";

/** Visible history cap for the director panel. Oldest lines drop first. */
export const DIRECTOR_HISTORY_VISIBLE_LIMIT = 80;

export type DirectorHistoryLine = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type DirectorHistory = {
  projectId: string;
  threadId: string | null;
  lines: DirectorHistoryLine[];
  truncated: boolean;
};

export function emptyDirectorHistory(projectId = ""): DirectorHistory {
  return { projectId, threadId: null, lines: [], truncated: false };
}

export function directorThreadReadHistoryParams(threadId: string): Record<string, unknown> {
  return { threadId, includeTurns: true };
}

export function limitDirectorHistoryLines(
  lines: DirectorHistoryLine[],
  limit = DIRECTOR_HISTORY_VISIBLE_LIMIT,
): { lines: DirectorHistoryLine[]; truncated: boolean } {
  if (lines.length <= limit) return { lines, truncated: false };
  return { lines: lines.slice(-limit), truncated: true };
}

/**
 * Official thread/read payload: `{ thread: { turns: [{ items: ThreadItem[] }] } }`.
 * Missing `thread` is invalid. Missing/non-array `turns` is old schema → empty lines.
 * Never throws.
 */
export function inspectDirectorThreadRead(
  result: unknown,
): { ok: true; lines: DirectorHistoryLine[] } | { ok: false } {
  try {
    const root = asRecord(result);
    if (!root) return { ok: false };
    const thread = asRecord(root.thread);
    if (!thread) return { ok: false };
    const turns = thread.turns === undefined
      ? []
      : Array.isArray(thread.turns)
        ? thread.turns
        : [];
    return { ok: true, lines: projectDirectorTurns(turns) };
  } catch {
    return { ok: false };
  }
}

function projectDirectorTurns(turns: unknown[]): DirectorHistoryLine[] {
  const lines: DirectorHistoryLine[] = [];
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = asRecord(turns[turnIndex]);
    if (!turn) continue;
    const items = Array.isArray(turn.items) ? turn.items : [];
    const turnId = typeof turn.id === "string" && turn.id.trim() ? turn.id.trim() : `turn-${turnIndex}`;
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const line = projectDirectorItem(items[itemIndex], `${turnId}:${itemIndex}`);
      if (line) lines.push(line);
    }
  }
  return lines;
}

function projectDirectorItem(item: unknown, fallbackId: string): DirectorHistoryLine | null {
  const rec = asRecord(item);
  if (!rec) return null;
  const type = rec.type;
  const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : fallbackId;
  if (type === "userMessage") {
    const text = unwrapDirectorUserText(readUserMessageText(rec.content)).trim();
    if (!text) return null;
    return { id, role: "user", text };
  }
  if (type === "agentMessage") {
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!text) return null;
    return { id, role: "assistant", text };
  }
  return null;
}

function readUserMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const rec = asRecord(part);
    if (!rec || rec.type !== "text") continue;
    if (typeof rec.text !== "string") continue;
    if (!rec.text.trim()) continue;
    parts.push(rec.text);
  }
  return parts.join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
