import { describe, expect, it } from 'vitest'
import {
  buildTimelineExportFilmPatch,
  ensureTimelineExportFilmNode,
  findTimelineExportFilmNode,
  TIMELINE_EXPORT_OUTPUT_KIND,
} from './timelineExportFilmNode'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

describe('timeline export film node', () => {
  it('recognizes an existing timeline-export video', () => {
    const nodes: Array<Pick<GenerationCanvasNode, 'kind' | 'meta'>> = [
      { kind: 'video', meta: {} },
      { kind: 'video', meta: { outputKind: TIMELINE_EXPORT_OUTPUT_KIND } },
    ]
    expect(findTimelineExportFilmNode(nodes)).toBe(1)
  })

  it('builds a success video patch bound to the export file', () => {
    const patch = buildTimelineExportFilmPatch({
      relativePath: 'exports/nomi-export.mp4',
      outputUrl: 'nomi-local://asset/p/exports/nomi-export.mp4',
      durationSeconds: 10.3,
      title: '成片',
    })
    expect(patch.status).toBe('success')
    expect(patch.result?.type).toBe('video')
    expect(patch.result?.url).toContain('nomi-export.mp4')
    expect(patch.meta?.outputKind).toBe(TIMELINE_EXPORT_OUTPUT_KIND)
  })

  it('reuses the existing film node instead of adding another', () => {
    const film: GenerationCanvasNode = {
      id: 'film-1',
      kind: 'video',
      title: '成片',
      position: { x: 0, y: 0 },
      meta: { outputKind: TIMELINE_EXPORT_OUTPUT_KIND },
    }
    const added: string[] = []
    const updated: Array<{ nodeId: string }> = []
    const id = ensureTimelineExportFilmNode({
      getState: () => ({
        nodes: [film],
        addNode: () => {
          added.push('new')
          return film
        },
        updateNode: (nodeId) => { updated.push({ nodeId }) },
      }),
    }, {
      relativePath: 'exports/b.mp4',
      outputUrl: 'nomi-local://b.mp4',
      durationSeconds: 5,
      title: '成片',
    })
    expect(id).toBe('film-1')
    expect(added).toEqual([])
    expect(updated).toEqual([{ nodeId: 'film-1' }])
  })
})
