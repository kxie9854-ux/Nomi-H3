const STORAGE_KEY = "nomi.director.skillIds"
const MODE_KEY = "nomi.director.skillMode"
export const DIRECTOR_MAX_OVERLAY_SKILLS = 3
export type DirectorSkillMode = "none" | "film" | "author"
export const DIRECTOR_SKILL_MODES = ["none", "film", "author"] as const

export function parseDirectorSkillMode(raw: unknown): DirectorSkillMode {
  return raw === "none" || raw === "author" ? raw : "film"
}

function safeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const id = raw.trim()
  if (!id || id.length > 80) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return null
  return id
}

export function normalizeDirectorSkillIds(ids: readonly unknown[], max = DIRECTOR_MAX_OVERLAY_SKILLS): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const id = safeId(raw)
    if (!id || id === "h3-autodl-art-director" || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= max) break
  }
  return out
}

export function toggleDirectorSkillId(current: readonly string[], id: string): string[] {
  const safe = safeId(id)
  if (!safe) return normalizeDirectorSkillIds(current)
  if (current.includes(safe)) return current.filter((item) => item !== safe)
  if (current.length >= DIRECTOR_MAX_OVERLAY_SKILLS) return [...current.slice(1), safe]
  return [...current, safe]
}

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

export function readDirectorSkillIds(projectId: string): string[] {
  const key = `${STORAGE_KEY}:${projectId.trim()}`
  if (!projectId.trim()) return []
  try {
    const raw = storageGet(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? normalizeDirectorSkillIds(parsed) : []
  } catch {
    return []
  }
}

export function writeDirectorSkillIds(projectId: string, ids: readonly string[]): string[] {
  const normalized = normalizeDirectorSkillIds(ids)
  const key = `${STORAGE_KEY}:${projectId.trim()}`
  if (!projectId.trim()) return normalized
  storageSet(key, JSON.stringify(normalized))
  return normalized
}

export function readDirectorSkillMode(projectId: string): DirectorSkillMode {
  if (!projectId.trim()) return "film"
  return parseDirectorSkillMode(storageGet(`${MODE_KEY}:${projectId.trim()}`))
}

export function writeDirectorSkillMode(projectId: string, mode: DirectorSkillMode): DirectorSkillMode {
  const next = parseDirectorSkillMode(mode)
  if (projectId.trim()) storageSet(`${MODE_KEY}:${projectId.trim()}`, next)
  return next
}
