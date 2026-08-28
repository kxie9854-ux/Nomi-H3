export const DIRECTOR_STAGES = ['brief', 'stills', 'confirm', 'render', 'film'] as const
export type DirectorStageId = (typeof DIRECTOR_STAGES)[number]

export type DirectorStageNode = {
  id: string
  kind: string
  status?: string
  result?: { url?: string; type?: string } | null
  meta?: Record<string, unknown>
}

function isBusy(node: DirectorStageNode): boolean {
  return node.status === 'running' || node.status === 'queued'
}

function hasUrl(node: DirectorStageNode): boolean {
  return Boolean(node.result?.url && String(node.result.url).trim())
}

export function timelineSourceNodeIds(timeline: {
  tracks: ReadonlyArray<{ clips: ReadonlyArray<{ sourceNodeId?: string }> }>
}): Set<string> {
  const ids = new Set<string>()
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.sourceNodeId) ids.add(clip.sourceNodeId)
    }
  }
  return ids
}

/** Canvas + timeline → which production step the director panel should highlight. */
export function inferDirectorStage(
  nodes: readonly DirectorStageNode[],
  onTimeline: ReadonlySet<string>,
): DirectorStageId {
  if (nodes.length === 0) return 'brief'

  const images = nodes.filter((node) => node.kind === 'image')
  const videos = nodes.filter((node) => node.kind === 'video')
  const videosWithResult = videos.filter((node) => hasUrl(node) && node.result?.type === 'video')

  if (videos.some(isBusy)) return 'render'
  if (images.some(isBusy)) return 'stills'
  if (nodes.some((node) => node.kind === 'video' && node.meta?.outputKind === 'timeline-export' && hasUrl(node))) {
    return 'film'
  }
  if (videosWithResult.length > 0) {
    const assembled = videosWithResult.every((node) => onTimeline.has(node.id))
    return assembled ? 'film' : 'render'
  }
  if (images.length > 0 && images.every(hasUrl) && videos.length > 0) return 'confirm'
  if (images.length > 0) return 'stills'
  return 'brief'
}
