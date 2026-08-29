const MODEL_KEY = "nomi.director.codexModel"
const EFFORT_KEY = "nomi.director.codexEffort"

const memory = new Map<string, string>()

function storageGet(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined") {
      const value = localStorage.getItem(key)
      if (value != null) return value
    }
  } catch {
    /* private mode */
  }
  return memory.get(key) ?? null
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value)
  } catch {
    /* quota / private mode */
  }
  memory.set(key, value)
}

/** Empty string means inherit ~/.codex/config.toml (omit turn/start keys). */
export function normalizeDirectorCodexOverride(raw: unknown): string {
  if (typeof raw !== "string") return ""
  const value = raw.trim()
  if (!value || value.length > 80) return ""
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) return ""
  return value
}

export function readDirectorCodexModel(): string {
  return normalizeDirectorCodexOverride(storageGet(MODEL_KEY))
}

export function writeDirectorCodexModel(model: unknown): string {
  const next = normalizeDirectorCodexOverride(model)
  storageSet(MODEL_KEY, next)
  return next
}

export function readDirectorCodexEffort(): string {
  return normalizeDirectorCodexOverride(storageGet(EFFORT_KEY))
}

export function writeDirectorCodexEffort(effort: unknown): string {
  const next = normalizeDirectorCodexOverride(effort)
  storageSet(EFFORT_KEY, next)
  return next
}

export const DIRECTOR_FALLBACK_REASONING_EFFORTS = ["low", "medium", "high"] as const
