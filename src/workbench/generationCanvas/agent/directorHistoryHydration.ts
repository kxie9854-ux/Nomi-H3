import type { DirectorHistoryLine } from '../../../../electron/codexAppServer/directorHistory'

export type DirectorPanelLine = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  origin?: 'history' | 'live'
}

export type DirectorHistoryRequestIdentity = {
  generation: number
  projectId: string
}

/**
 * History can finish after a project switch. Apply it only when every identity
 * still points at the same project that started the request.
 */
export function isCurrentDirectorHistoryResponse(input: {
  request: DirectorHistoryRequestIdentity
  latestGeneration: number
  activeProjectId: string
  responseProjectId: string
}): boolean {
  return input.request.generation === input.latestGeneration
    && input.request.projectId === input.activeProjectId
    && input.request.projectId === input.responseProjectId
}

function sameVisibleLine(left: DirectorPanelLine, right: DirectorPanelLine): boolean {
  return left.role === right.role
    && Boolean(left.text.trim())
    && left.text.trim() === right.text.trim()
}

/**
 * Keep official item ids as the durable identity. A local optimistic line has
 * no app-server item id yet, so an exact role/text match near the history tail
 * is its compatibility identity while hydration races a send.
 */
export function mergeDirectorHistoryLines(
  history: readonly DirectorHistoryLine[],
  live: readonly DirectorPanelLine[],
): DirectorPanelLine[] {
  const merged: DirectorPanelLine[] = history.map((line) => ({ ...line, origin: 'history' }))
  for (const line of live) {
    const sameIdIndex = merged.findIndex((candidate) => candidate.id === line.id)
    if (sameIdIndex >= 0) {
      if (line.text.length > merged[sameIdIndex].text.length) merged[sameIdIndex] = { ...line }
      continue
    }
    const duplicateVisibleLine = merged.slice(-8).some((candidate) => sameVisibleLine(candidate, line))
    if (!duplicateVisibleLine) merged.push({ ...line })
  }
  return merged
}
