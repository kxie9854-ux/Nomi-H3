import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DIRECTOR_LEGACY_SESSION_KEY,
  directorSessionKey,
  directorThreadMapPath,
  loadDirectorThreadMap,
  normalizeDirectorProjectId,
  normalizeDirectorThreadId,
  saveDirectorThreadMap,
  snapshotDirectorThreadMap,
} from "./directorThreadMap";

const tempDirs: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-director-threads-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("normalizeDirectorProjectId", () => {
  it("accepts Nomi project ids and Codex thread ids", () => {
    expect(normalizeDirectorProjectId("project-1787501041770-jivtcp")).toBe("project-1787501041770-jivtcp");
    expect(normalizeDirectorThreadId("  019f7960-95a5-7140-8749-a3cf59e0ffab  ")).toBe("019f7960-95a5-7140-8749-a3cf59e0ffab");
  });

  it("rejects empty, oversized, and path-traversal ids", () => {
    expect(normalizeDirectorProjectId("")).toBeNull();
    expect(normalizeDirectorProjectId("   ")).toBeNull();
    expect(normalizeDirectorProjectId("../etc/passwd")).toBeNull();
    expect(normalizeDirectorProjectId("..\\windows")).toBeNull();
    expect(normalizeDirectorProjectId("foo/../../bar")).toBeNull();
    expect(normalizeDirectorProjectId("project/../../secret")).toBeNull();
    expect(normalizeDirectorProjectId("a\0b")).toBeNull();
    expect(normalizeDirectorProjectId(".")).toBeNull();
    expect(normalizeDirectorProjectId("..")).toBeNull();
    expect(normalizeDirectorProjectId("x".repeat(201))).toBeNull();
  });

  it("maps missing or unsafe ids onto a stable legacy session key", () => {
    expect(directorSessionKey("project-a")).toBe("project-a");
    expect(directorSessionKey("")).toBe(DIRECTOR_LEGACY_SESSION_KEY);
    expect(directorSessionKey(undefined)).toBe(DIRECTOR_LEGACY_SESSION_KEY);
    expect(directorSessionKey("../etc/passwd")).toBe(DIRECTOR_LEGACY_SESSION_KEY);
    expect(DIRECTOR_LEGACY_SESSION_KEY).toBe("__legacy__");
    expect(normalizeDirectorProjectId(DIRECTOR_LEGACY_SESSION_KEY)).toBe(DIRECTOR_LEGACY_SESSION_KEY);
  });
});

describe("directorThreadMap persistence", () => {
  it("writes one JSON file under the settings root and never uses projectId as a path", () => {
    const root = tempRoot();
    const filePath = directorThreadMapPath(root);
    expect(filePath.startsWith(root)).toBe(true);
    expect(filePath.endsWith(path.join("codex-director", "project-threads.json"))).toBe(true);

    const map = new Map<string, string>([
      ["project-a", "thread-a"],
      ["../escape", "thread-bad"],
      ["project-b", "thread-b"],
    ]);
    saveDirectorThreadMap(filePath, map);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(path.resolve(root, "..", "escape"))).toBe(false);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    expect(raw).toEqual({
      version: 1,
      threads: { "project-a": "thread-a", "project-b": "thread-b" },
    });
    expect(raw).not.toHaveProperty("elicitation");
    expect(raw).not.toHaveProperty("spend");
    expect(raw).not.toHaveProperty("grant");
    expect(raw).not.toHaveProperty("turn");
  });

  it("round-trips a map and ignores corrupt or unsafe records", () => {
    const root = tempRoot();
    const filePath = directorThreadMapPath(root);
    saveDirectorThreadMap(filePath, new Map([["project-a", "thread-a"]]));
    expect(Object.fromEntries(loadDirectorThreadMap(filePath))).toEqual({ "project-a": "thread-a" });

    fs.writeFileSync(filePath, "{not json", "utf8");
    expect(loadDirectorThreadMap(filePath).size).toBe(0);

    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      threads: {
        "project-ok": "thread-ok",
        "../x": "thread-x",
        "project-empty": "",
      },
      pendingElicitation: { requestId: "1" },
      spendTrust: { scope: "p1" },
    }), "utf8");
    expect(Object.fromEntries(loadDirectorThreadMap(filePath))).toEqual({ "project-ok": "thread-ok" });
  });

  it("snapshot never copies pending elicitation, spend trust, grant, or turn state", () => {
    const snapshot = snapshotDirectorThreadMap(new Map([["p1", "t1"]]));
    expect(Object.keys(snapshot).sort()).toEqual(["threads", "version"]);
    expect(snapshot.threads).toEqual({ p1: "t1" });
  });
});
