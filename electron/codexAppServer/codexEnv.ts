const CODEX_INHERITED_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "CODEX_HOME",
] as const;

/** Env for the Codex app-server child: allowlisted OS/login keys plus Nomi roots. Never Electron secrets. */
export function codexAppServerEnv(
  extraEnv: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CODEX_INHERITED_ENV_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value) env[key] = value;
  }
  return { ...env, ...extraEnv };
}
