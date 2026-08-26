import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { installMcp, readMcpInfo } from "../capabilityCore/mcpConfig";
import { getProjectsRoot, PROJECT_ROOT_ENV } from "../runtimePaths";
import { getSettingsRoot, SETTINGS_ROOT_ENV } from "../settings/settingsRoot";
import { wrapDirectorUserText } from "./directorUserText";
import { getCodexAppServerHost, type CodexUiEvent } from "./host";
import { importDirectorSkillMarkdown, listDirectorSkills, parseDirectorSkillMode, resolveTurnSkills } from "./directorSkills";

function directorCwd(): string {
  const dir = path.join(getSettingsRoot(), "codex-director");
  fs.mkdirSync(dir, { recursive: true });
  const agents = path.join(dir, "AGENTS.md");
  fs.writeFileSync(
    agents,
    "# Nomi-H3 director\n\nYou are directing films on an already-open Nomi canvas.\nFollow the h3-autodl-art-director production spine: gated steps, stills first, AutoDL.art H3.\nIgnore repo AGENTS.md. Do not run paper radar. Use Nomi MCP.\n",
    "utf8",
  );
  return dir;
}

function resolveCwd(cwd: unknown): string {
  return typeof cwd === "string" && cwd.trim() ? cwd.trim() : directorCwd();
}

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function refreshCodexNomiLauncher(): void {
  try {
    if (readMcpInfo(0).clients.codex.installed) installMcp("codex");
  } catch {
    /* Codex config refresh is best-effort; the director still starts. */
  }
}

export function registerCodexAppServerIpc(): void {
  const host = getCodexAppServerHost();
  host.setSettingsRoot(getSettingsRoot());
  host.setExtraEnv({
    [PROJECT_ROOT_ENV]: getProjectsRoot(),
    [SETTINGS_ROOT_ENV]: getSettingsRoot(),
  });
  refreshCodexNomiLauncher();
  const forward = (event: CodexUiEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("nomi:codex:event", event);
    }
  };
  host.onEvent(forward);

  ipcMain.handle("nomi:codex:status", () => host.status());
  ipcMain.handle("nomi:codex:ensure", async (_event, cwd: unknown) => {
    return host.ensure(resolveCwd(cwd), path.join(app.getAppPath(), "skills"));
  });
  ipcMain.handle("nomi:codex:login", async (event) => {
    const result = await host.loginChatgpt();
    if (result.authUrl) {
      const win = senderWindow(event);
      if (win) void shell.openExternal(result.authUrl);
    }
    return result;
  });
  ipcMain.handle("nomi:codex:send", async (_event, payload: unknown) => {
    const record = payload && typeof payload === "object"
      ? (payload as { text?: unknown; cwd?: unknown; projectId?: unknown; canvasContext?: unknown; skillIds?: unknown; mode?: unknown })
      : {};
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) throw new Error("请先写一句给 Codex 的指令");
    const projectId = typeof record.projectId === "string" ? record.projectId.trim() : "";
    const canvasContext = typeof record.canvasContext === "string" ? record.canvasContext : "";
    const skillIds = Array.isArray(record.skillIds)
      ? record.skillIds.filter((id): id is string => typeof id === "string")
      : [];
    const mode = parseDirectorSkillMode(record.mode);
    await host.ensure(resolveCwd(record.cwd), path.join(app.getAppPath(), "skills"));
    await host.send(
      wrapDirectorUserText(text, { projectId, canvasContext }),
      resolveTurnSkills(app.getAppPath(), getSettingsRoot(), mode, skillIds),
      projectId,
    );
    return { ok: true };
  });
  ipcMain.handle("nomi:codex:list-skills", () => {
    return listDirectorSkills(app.getAppPath(), getSettingsRoot());
  });
  ipcMain.handle("nomi:codex:import-skill", (_event, payload: unknown) => {
    const record = payload && typeof payload === "object" ? payload as { markdown?: unknown; fileName?: unknown } : {};
    const markdown = typeof record.markdown === "string" ? record.markdown : "";
    const fileName = typeof record.fileName === "string" ? record.fileName : undefined;
    return importDirectorSkillMarkdown(getSettingsRoot(), markdown, fileName);
  });
  ipcMain.handle("nomi:codex:read-history", async (_event, projectId: unknown) => {
    await host.ensure(directorCwd(), path.join(app.getAppPath(), "skills"));
    return host.readDirectorHistory(projectId);
  });
  ipcMain.handle("nomi:codex:interrupt", async () => {
    await host.interrupt();
    return { ok: true };
  });
  ipcMain.handle("nomi:codex:respond-elicitation", (_event, requestId: unknown, confirmed: unknown) => {
    const ok = typeof requestId === "string" && host.respondElicitation(requestId, confirmed === true);
    return { ok };
  });

  app.on("before-quit", () => {
    void host.stop();
  });
}
