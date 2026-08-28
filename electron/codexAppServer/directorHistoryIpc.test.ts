import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DesktopBridge } from "../../src/desktop/bridge";
import type { DirectorHistory } from "./directorHistory";

const ipcSource = fs.readFileSync(path.join(process.cwd(), "electron/codexAppServer/ipc.ts"), "utf8");
const preloadSource = fs.readFileSync(path.join(process.cwd(), "electron/preload.ts"), "utf8");
const bridgeSource = fs.readFileSync(path.join(process.cwd(), "src/desktop/bridge.ts"), "utf8");
const codexBridgeSource = fs.readFileSync(path.join(process.cwd(), "src/desktop/codexBridge.ts"), "utf8");
const hostSource = fs.readFileSync(path.join(process.cwd(), "electron/codexAppServer/host.ts"), "utf8");

const historyShape: DirectorHistory = {
  projectId: "project-a",
  threadId: "thread-1",
  lines: [{ id: "u1", role: "user", text: "生成小猫" }],
  truncated: false,
};

describe("director history IPC contract", () => {
  it("exposes readHistory(projectId) on ipc, preload, and the desktop bridge", () => {
    expect(ipcSource).toContain('ipcMain.handle("nomi:codex:read-history"');
    expect(preloadSource).toMatch(/readHistory:\s*\(projectId:\s*string\)\s*=>\s*ipcRenderer\.invoke\("nomi:codex:read-history",\s*projectId\)/);
    expect(bridgeSource).toContain("codex?: CodexDesktopBridge");
    expect(codexBridgeSource).toContain("readHistory: (projectId: string) => Promise<DirectorHistory>");

    const history: NonNullable<DesktopBridge["codex"]>["readHistory"] extends (
      projectId: string,
    ) => Promise<DirectorHistory> ? true : false = true;
    expect(history).toBe(true);
    expect(Object.keys(historyShape).sort()).toEqual(["lines", "projectId", "threadId", "truncated"]);
    expect(historyShape).not.toHaveProperty("elicitation");
    expect(historyShape).not.toHaveProperty("spend");
    expect(historyShape).not.toHaveProperty("grant");
    expect(historyShape).not.toHaveProperty("activeTurn");
    expect(historyShape).not.toHaveProperty("busy");
    expect(historyShape).not.toHaveProperty("activity");
  });

  it("does not persist or return live turn/elicitation state from the history path", () => {
    const readMethod = hostSource.match(/async readDirectorHistory[\s\S]*?\n  async interrupt/)?.[0] ?? "";
    expect(readMethod).toContain("directorThreadReadHistoryParams");
    expect(readMethod).not.toContain("ensureProjectThread");
    expect(readMethod).not.toContain("CODEX_THREAD_START");
    expect(readMethod).not.toContain("CODEX_THREAD_RESUME");
    expect(readMethod).not.toContain("pendingElicitations");
    expect(readMethod).not.toContain("activeTurn");
    expect(ipcSource).not.toMatch(/nomi:codex:read-history[\s\S]{0,400}respondElicitation/);
  });

  it("authenticates every Codex renderer-to-main IPC handler", () => {
    const registrations = ipcSource.match(/ipcMain\.handle\("nomi:codex:/g) ?? [];
    const senderGuards = ipcSource.match(/assertTrustedSender\(event\)/g) ?? [];
    expect(registrations).toHaveLength(9);
    expect(senderGuards).toHaveLength(registrations.length);
  });
});
