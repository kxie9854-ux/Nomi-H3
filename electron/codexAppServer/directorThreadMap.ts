import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "../jsonFile";

/** Confirmed mapping filename under the Nomi settings root. Project IDs are JSON keys, never path segments. */
export const DIRECTOR_THREAD_MAP_RELATIVE = path.join("codex-director", "project-threads.json");

/** Stable map key when renderer/IPC omit projectId. Never a filesystem path. */
export const DIRECTOR_LEGACY_SESSION_KEY = "__legacy__";

export type DirectorThreadMapSnapshot = {
  version: 1;
  threads: Record<string, string>;
};

function isPathishId(id: string): boolean {
  if (id === "." || id === "..") return true;
  if (id.includes("\0") || id.includes("/") || id.includes("\\")) return true;
  if (id.includes("..")) return true;
  return false;
}

/** Opaque session key: trimmed, non-empty, and never usable as a filesystem path. */
export function normalizeDirectorOpaqueId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > 200) return null;
  if (isPathishId(id)) return null;
  return id;
}

export function normalizeDirectorProjectId(raw: unknown): string | null {
  return normalizeDirectorOpaqueId(raw);
}

export function normalizeDirectorThreadId(raw: unknown): string | null {
  return normalizeDirectorOpaqueId(raw);
}

export function directorSessionKey(raw: unknown): string {
  return normalizeDirectorProjectId(raw) ?? DIRECTOR_LEGACY_SESSION_KEY;
}

export function directorThreadMapPath(settingsRoot: string): string {
  if (!path.isAbsolute(settingsRoot)) {
    throw new Error("director thread map requires an absolute settings root");
  }
  const resolved = path.resolve(settingsRoot, DIRECTOR_THREAD_MAP_RELATIVE);
  const root = path.resolve(settingsRoot);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error("director thread map escaped the settings root");
  }
  return resolved;
}

export function emptyDirectorThreadMap(): Map<string, string> {
  return new Map();
}

export function snapshotDirectorThreadMap(map: Map<string, string>): DirectorThreadMapSnapshot {
  const threads: Record<string, string> = {};
  for (const [projectId, threadId] of map) {
    const safeProject = normalizeDirectorProjectId(projectId);
    const safeThread = normalizeDirectorThreadId(threadId);
    if (safeProject && safeThread) threads[safeProject] = safeThread;
  }
  return { version: 1, threads };
}

export function loadDirectorThreadMap(filePath: string): Map<string, string> {
  const out = emptyDirectorThreadMap();
  try {
    if (!fs.existsSync(filePath)) return out;
    const raw = readJsonFile(filePath);
    const record = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as { threads?: unknown }
      : null;
    const threads = record?.threads && typeof record.threads === "object" && !Array.isArray(record.threads)
      ? record.threads as Record<string, unknown>
      : null;
    if (!threads) return out;
    for (const [projectId, threadId] of Object.entries(threads)) {
      const safeProject = normalizeDirectorProjectId(projectId);
      const safeThread = normalizeDirectorThreadId(threadId);
      if (safeProject && safeThread) out.set(safeProject, safeThread);
    }
    return out;
  } catch {
    return out;
  }
}

export function saveDirectorThreadMap(filePath: string, map: Map<string, string>): void {
  writeJsonFileAtomic(filePath, snapshotDirectorThreadMap(map));
}
