import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultTimeline } from '../timeline/timelineMath'
import type { TimelineClip, TimelineState, TimelineTrack } from '../timeline/timelineTypes'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'

const exportTimelineToMp4 = vi.fn()

vi.mock('../export/exportApi', () => ({
  exportTimelineToMp4: (...args: unknown[]) => exportTimelineToMp4(...args),
}))

vi.mock('../project/workbenchProjectSession', () => ({
  getActiveWorkbenchProjectId: () => 'proj-1',
}))

import { handleCapabilityApply } from './capabilityApplyHandler'

function videoClip(): TimelineClip {
  return {
    id: 'clip-1',
    type: 'video',
    sourceNodeId: 'node-1',
    label: 'S01',
    startFrame: 0,
    endFrame: 150,
    frameCount: 150,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
  }
}

function timelineWithVideo(): TimelineState {
  const tracks: TimelineTrack[] = createDefaultTimeline().tracks.map((track) => (
    track.type === 'video' ? { ...track, clips: [videoClip()] } : track
  ))
  return { ...createDefaultTimeline(), tracks }
}

describe('timeline.export capability', () => {
  beforeEach(() => {
    exportTimelineToMp4.mockReset()
    useWorkbenchStore.setState({
      timeline: createDefaultTimeline(),
      previewAspectRatio: '9:16',
    })
    useGenerationCanvasStore.setState({ nodes: [], edges: [], groups: [] })
  })

  it('refuses when the timeline has no picture', async () => {
    await expect(handleCapabilityApply('timeline.export', { projectId: 'proj-1' })).rejects.toThrow(
      '时间轴没有画面，先 nomi_assemble_timeline',
    )
    expect(exportTimelineToMp4).not.toHaveBeenCalled()
  })

  it('exports the open timeline and returns the film card id', async () => {
    useWorkbenchStore.setState({ timeline: timelineWithVideo(), previewAspectRatio: '9:16' })
    exportTimelineToMp4.mockResolvedValue({ relativePath: 'exports/film.mp4', size: 88 })

    const result = await handleCapabilityApply('timeline.export', {
      projectId: 'proj-1',
      outputName: 'film.mp4',
    }) as { relativePath: string; size: number; filmNodeId: string }

    expect(exportTimelineToMp4).toHaveBeenCalledTimes(1)
    expect(exportTimelineToMp4.mock.calls[0][0]).toMatchObject({
      projectId: 'proj-1',
      outputName: 'film.mp4',
      aspectRatio: '9:16',
    })
    expect(result.relativePath).toBe('exports/film.mp4')
    expect(result.size).toBe(88)
    expect(result.filmNodeId).toEqual(expect.any(String))
    expect(result.filmNodeId.length).toBeGreaterThan(0)
  })
})
