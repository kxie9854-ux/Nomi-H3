/** Artifact 出口的最终脱敏缝：旧快照即使夹带凭据/本机路径，也不能经 MCP 暴露。 */
export function safeArtifactValue(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => safeArtifactValue(item))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (/api.?key|secret|authorization|provider.?url|private.?url|access.?token/i.test(childKey)) continue
      out[childKey] = safeArtifactValue(childValue, childKey)
    }
    return out
  }
  if (typeof value === 'string' && /path|file/i.test(key) && (/^(?:\/|[A-Za-z]:[\\/])/.test(value) || value.includes('\\'))) return '[redacted]'
  if (typeof value === 'string' && /^https?:\/\//i.test(value) && /provider|vendor|source/i.test(key)) return '[redacted]'
  return value
}

export function sanitizeArtifactResource(value: unknown): unknown {
  return safeArtifactValue(value)
}
