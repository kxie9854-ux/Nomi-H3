import { describe, expect, it } from 'vitest'
import { inferDirectorStage, timelineSourceNodeIds, type DirectorStageNode } from './directorStage'

const node = (over: Partial<DirectorStageNode> & Pick<DirectorStageNode, 'id' | 'kind'>): DirectorStageNode => over

describe('inferDirectorStage', () => {
  it('starts at brief on an empty canvas', () => {
    expect(inferDirectorStage([], new Set())).toBe('brief')
  })

  it('stays on stills until every image has a result', () => {
    expect(inferDirectorStage([
      node({ id: 'a', kind: 'image', result: { url: 'nomi-local://a.jpg', type: 'image' } }),
      node({ id: 'b', kind: 'image' }),
    ], new Set())).toBe('stills')
  })

  it('waits for confirm when stills are ready and the video has not run', () => {
    expect(inferDirectorStage([
      node({ id: 'a', kind: 'image', result: { url: 'nomi-local://a.jpg', type: 'image' } }),
      node({ id: 'v', kind: 'video' }),
    ], new Set())).toBe('confirm')
  })

  it('highlights render while the video is running or sitting as a clip off the timeline', () => {
    expect(inferDirectorStage([
      node({ id: 'v', kind: 'video', status: 'running' }),
    ], new Set())).toBe('render')
    expect(inferDirectorStage([
      node({ id: 'v', kind: 'video', result: { url: 'nomi-local://v.mp4', type: 'video' } }),
    ], new Set())).toBe('render')
  })

  it('reaches film when every video result is on the timeline', () => {
    expect(inferDirectorStage([
      node({ id: 'v', kind: 'video', result: { url: 'nomi-local://v.mp4', type: 'video' } }),
    ], new Set(['v']))).toBe('film')
  })
})

describe('timelineSourceNodeIds', () => {
  it('collects sourceNodeId across tracks', () => {
    expect(timelineSourceNodeIds({
      tracks: [
        { clips: [{ sourceNodeId: 'v1' }, {}] },
        { clips: [{ sourceNodeId: 'v2' }] },
      ],
    })).toEqual(new Set(['v1', 'v2']))
  })
})
