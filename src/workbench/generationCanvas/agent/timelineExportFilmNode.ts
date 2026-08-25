import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

export const TIMELINE_EXPORT_OUTPUT_KIND = 'timeline-export'

export type TimelineExportFilmInput = {
  relativePath: string
  outputUrl: string
  durationSeconds: number
  title: string
}

export type TimelineExportFilmPatch = Pick<GenerationCanvasNode, 'result' | 'status' | 'meta'>

export function findTimelineExportFilmNode(
  nodes: readonly Pick<GenerationCanvasNode, 'kind' | 'meta'>[],
): number {
  return nodes.findIndex((node) => (
    node.kind === 'video' && node.meta?.outputKind === TIMELINE_EXPORT_OUTPUT_KIND
  ))
}

export function buildTimelineExportFilmPatch(input: TimelineExportFilmInput): TimelineExportFilmPatch {
  const result: GenerationNodeResult = {
    id: `timeline-export:${input.relativePath}`,
    type: 'video',
    url: input.outputUrl,
    durationSeconds: Math.max(0.1, input.durationSeconds),
    taskKind: 'asset',
    createdAt: Date.now(),
  }
  return {
    result,
    status: 'success',
    meta: {
      outputKind: TIMELINE_EXPORT_OUTPUT_KIND,
      outputRelativePath: input.relativePath,
    },
  }
}

export type TimelineExportFilmStore = {
  getState: () => {
    nodes: GenerationCanvasNode[]
    addNode: (input: {
      kind: 'video'
      title: string
      categoryId: 'shots'
      select: false
    }) => GenerationCanvasNode
    updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>) => void
  }
}

/** Idempotent: reuse the existing 成片 video node if the canvas already has one. */
export function ensureTimelineExportFilmNode(
  store: TimelineExportFilmStore,
  input: TimelineExportFilmInput,
): string {
  const state = store.getState()
  const existingIndex = findTimelineExportFilmNode(state.nodes)
  const existing = existingIndex >= 0 ? state.nodes[existingIndex] : undefined
  const node = existing ?? state.addNode({
    kind: 'video',
    title: input.title,
    categoryId: 'shots',
    select: false,
  })
  store.getState().updateNode(node.id, buildTimelineExportFilmPatch(input))
  return node.id
}
