import { describe, expect, it } from 'vitest'
import { createDefaultTimeline } from '../../timeline/timelineMath'
import type { TimelineState } from '../../timeline/timelineTypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { buildDirectorRestoreSummary, formatDirectorTimelineDuration } from './directorRestoreSummary'

function videoNode(id: string): GenerationCanvasNode {
  return {
    id,
    kind: 'video',
    title: id,
    position: { x: 0, y: 0 },
    result: { id: `${id}-result`, type: 'video', url: `nomi-local://${id}.mp4`, createdAt: 1 },
  }
}

describe('director restore summary', () => {
  it('formats timeline duration from the persisted fps instead of hardcoding 30', () => {
    expect(formatDirectorTimelineDuration(620, 60)).toBe('0:10')
  })

  it('derives the approved film summary facts from canvas and timeline', () => {
    const timeline: TimelineState = {
      ...createDefaultTimeline(),
      fps: 60,
      tracks: [
        { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
        {
          id: 'videoTrack',
          type: 'video',
          label: '视频轨',
          clips: [
            { id: 'c1', type: 'video', sourceNodeId: 's1', label: 'S01', startFrame: 0, endFrame: 310, frameCount: 310, offsetStartFrame: 0, offsetEndFrame: 0 },
            { id: 'c2', type: 'video', sourceNodeId: 's2', label: 'S02', startFrame: 310, endFrame: 620, frameCount: 310, offsetStartFrame: 0, offsetEndFrame: 0 },
          ],
        },
        { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
      ],
    }

    expect(buildDirectorRestoreSummary({
      nodes: [videoNode('s1'), videoNode('s2')],
      timeline,
      aspectRatio: '9:16',
      stage: 'film',
    })).toEqual({
      stage: 'film',
      nodeCount: 2,
      completedImageCount: 0,
      completedVideoCount: 2,
      timelineDuration: '0:10',
      aspectRatio: '9:16',
    })
  })
})
