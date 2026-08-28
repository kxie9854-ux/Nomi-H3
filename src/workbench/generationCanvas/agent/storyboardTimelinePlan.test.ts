import { describe, expect, it } from 'vitest'
import { planImportedAudio, planStoryboardTimeline } from './storyboardTimelinePlan'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationNodeKind,
  GenerationNodeResult,
} from '../model/generationCanvasTypes'

function node(
  id: string,
  kind: GenerationNodeKind,
  shotIndex: number | undefined,
  result?: Partial<GenerationNodeResult>,
  y = 0,
): GenerationCanvasNode {
  return {
    id,
    kind,
    title: id,
    position: { x: 0, y },
    categoryId: 'shots',
    ...(typeof shotIndex === 'number' ? { shotIndex } : {}),
    ...(result
      ? { result: { id: `${id}-r`, type: 'video', url: `file://${id}.mp4`, ...result } as GenerationNodeResult }
      : {}),
  }
}

function edge(source: string, target: string, mode?: GenerationCanvasEdge['mode']): GenerationCanvasEdge {
  return { id: `${source}-${target}`, source, target, ...(mode ? { mode } : {}) }
}

describe('planStoryboardTimeline', () => {
  it('orders generated videos by shotIndex regardless of array order', () => {
    const nodes = [
      node('v3', 'video', 3, { type: 'video' }),
      node('v1', 'video', 1, { type: 'video' }),
      node('v2', 'video', 2, { type: 'video' }),
    ]
    const { units, skipped } = planStoryboardTimeline(nodes, [])
    expect(units.map((u) => u.nodeId)).toEqual(['v1', 'v2', 'v3'])
    expect(units.every((u) => u.role === 'video')).toBe(true)
    expect(skipped).toEqual([])
  })

  it('falls back to the keyframe image as a placeholder when the video is not generated', () => {
    const nodes = [
      node('kf1', 'image', 1, { type: 'image', url: 'file://kf1.png' }),
      node('v1', 'video', 2, undefined), // not generated
    ]
    const edges = [edge('kf1', 'v1', 'first_frame')]
    const { units, skipped } = planStoryboardTimeline(nodes, edges)
    // placeholder takes the video's script slot; keyframe is not double-placed as a still
    expect(units).toEqual([{ nodeId: 'kf1', shotIndex: 2, role: 'placeholder' }])
    expect(skipped).toEqual([])
  })

  it('dedups: a keyframe feeding a generated video is not placed independently', () => {
    const nodes = [
      node('kf1', 'image', 1, { type: 'image', url: 'file://kf1.png' }),
      node('v1', 'video', 2, { type: 'video' }),
    ]
    const edges = [edge('kf1', 'v1', 'first_frame')]
    const { units } = planStoryboardTimeline(nodes, edges)
    expect(units).toEqual([{ nodeId: 'v1', shotIndex: 2, role: 'video' }])
  })

  it('skips a shot whose video and keyframe are both ungenerated, reporting the video', () => {
    const nodes = [
      node('kf1', 'image', 1, undefined),
      node('v1', 'video', 2, undefined),
    ]
    const edges = [edge('kf1', 'v1', 'first_frame')]
    const { units, skipped } = planStoryboardTimeline(nodes, edges)
    expect(units).toEqual([])
    expect(skipped.map((s) => s.nodeId)).toEqual(['v1'])
  })

  it('arranges a pure-image storyboard (no video nodes) by shotIndex', () => {
    const nodes = [
      node('img2', 'image', 2, { type: 'image', url: 'file://2.png' }),
      node('img1', 'image', 1, { type: 'image', url: 'file://1.png' }),
    ]
    const { units } = planStoryboardTimeline(nodes, [])
    expect(units.map((u) => u.nodeId)).toEqual(['img1', 'img2'])
    expect(units.every((u) => u.role === 'still')).toBe(true)
  })

  it('honors a scope subset and ignores non-shot nodes', () => {
    const nodes = [
      node('v1', 'video', 1, { type: 'video' }),
      node('v2', 'video', 2, { type: 'video' }),
      { ...node('t1', 'text', undefined), categoryId: 'shots' } as GenerationCanvasNode,
    ]
    const { units } = planStoryboardTimeline(nodes, [], ['v2'])
    expect(units.map((u) => u.nodeId)).toEqual(['v2'])
  })

  it('mixes generated videos and placeholders in one ordered sequence', () => {
    const nodes = [
      node('kf1', 'image', 1, { type: 'image', url: 'file://kf1.png' }),
      node('v1', 'video', 2, { type: 'video' }),
      node('kf2', 'image', 3, { type: 'image', url: 'file://kf2.png' }),
      node('v2', 'video', 4, undefined), // not generated -> kf2 placeholder
    ]
    const edges = [edge('kf1', 'v1', 'first_frame'), edge('kf2', 'v2', 'first_frame')]
    const { units } = planStoryboardTimeline(nodes, edges)
    expect(units).toEqual([
      { nodeId: 'v1', shotIndex: 2, role: 'video' },
      { nodeId: 'kf2', shotIndex: 4, role: 'placeholder' },
    ])
  })
})

describe('planImportedAudio', () => {
  it('places audio nodes with results onto their own track plan', () => {
    const nodes = [
      node('v1', 'video', 1, { type: 'video' }),
      { ...node('bgm', 'audio', undefined, { type: 'audio', url: 'nomi-local://bgm.mp3' }), categoryId: 'audio' },
      { ...node('empty', 'audio', undefined), categoryId: 'audio' },
    ]
    expect(planImportedAudio(nodes)).toEqual([{ nodeId: 'bgm', shotIndex: 0, role: 'audio' }])
    expect(planStoryboardTimeline(nodes, []).units.map((unit) => unit.nodeId)).toEqual(['v1'])
  })

  it('honors assemble scope for audio', () => {
    const nodes = [
      { ...node('a', 'audio', undefined, { type: 'audio', url: 'nomi-local://a.mp3' }), categoryId: 'audio' },
      { ...node('b', 'audio', undefined, { type: 'audio', url: 'nomi-local://b.mp3' }), categoryId: 'audio' },
    ]
    expect(planImportedAudio(nodes, ['b']).map((unit) => unit.nodeId)).toEqual(['b'])
  })
})
