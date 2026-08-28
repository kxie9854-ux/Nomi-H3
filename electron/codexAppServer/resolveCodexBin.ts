import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CHATGPT_APP_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex";

export function resolveCodexBin(home = os.homedir(), platform = process.platform): string | null {
  const candidates = [
    CHATGPT_APP_CODEX,
    path.join(home, ".codex", "plugins", ".plugin-appserver", "codex"),
    path.join(home, ".local", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  if (platform === "win32") return null;
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export const CHATGPT_BUNDLED_CODEX = CHATGPT_APP_CODEX;
