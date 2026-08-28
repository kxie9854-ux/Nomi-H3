import type { PreviewAspectRatio } from '../../workbenchTypes'
import type { TimelineState } from '../../timeline/timelineTypes'
import { computeTimelineDuration } from '../../timeline/timelineMath'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { DirectorStageId } from './directorStage'

export type DirectorRestoreSummary = {
  stage: DirectorStageId
  nodeCount: number
  completedImageCount: number
  completedVideoCount: number
  timelineDuration: string
  aspectRatio: PreviewAspectRatio
}

function hasResult(node: GenerationCanvasNode, type: 'image' | 'video'): boolean {
  return node.result?.type === type && Boolean(node.result.url?.trim())
}

export function formatDirectorTimelineDuration(frameCount: number, fps: number): string {
  const seconds = Math.max(0, Math.round(frameCount / Math.max(1, fps)))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/** Canvas + timeline are the only production-state truth sources. */
export function buildDirectorRestoreSummary(input: {
  nodes: readonly GenerationCanvasNode[]
  timeline: TimelineState
  aspectRatio: PreviewAspectRatio
  stage: DirectorStageId
}): DirectorRestoreSummary {
  return {
    stage: input.stage,
    nodeCount: input.nodes.length,
    completedImageCount: input.nodes.filter((node) => hasResult(node, 'image')).length,
    completedVideoCount: input.nodes.filter((node) => hasResult(node, 'video')).length,
    timelineDuration: formatDirectorTimelineDuration(
      computeTimelineDuration(input.timeline),
      input.timeline.fps,
    ),
    aspectRatio: input.aspectRatio,
  }
}

