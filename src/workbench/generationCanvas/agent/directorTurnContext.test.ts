import { describe, expect, it } from 'vitest'
import { buildDirectorCanvasContext } from './directorTurnContext'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const node = (over: Partial<GenerationCanvasNode>): GenerationCanvasNode => ({
  id: 'n1',
  kind: 'video',
  title: '小猫',
  position: { x: 0, y: 0 },
  ...over,
})

describe('buildDirectorCanvasContext', () => {
  it('tells Codex to create on the open project when nothing is selected', () => {
    const text = buildDirectorCanvasContext({ nodes: [], edges: [] }, [])
    expect(text).toContain('没有选中节点')
    expect(text).toContain('一镜还是多镜')
    expect(text).toContain('画布当前为空')
  })

  it('lists selected node ids so iterate-this-shot can target nomi_generate', () => {
    const selected = node({
      id: 'node-cat',
      title: '晨光花园里的小猫',
      prompt: 'orange kitten',
      status: 'success',
      result: { id: 'r1', type: 'video', url: 'nomi-local://asset/cat.mp4' },
    })
    const text = buildDirectorCanvasContext(
      { nodes: [selected], edges: [], selectedNodeIds: ['node-cat'] },
      [selected],
    )
    expect(text).toContain('node-cat')
    expect(text).toContain('只操作这些 nodeId')
    expect(text).toContain('nomi-local://asset/cat.mp4')
  })

  it('tells fl2va when two stills with results are selected', () => {
    const first = node({
      id: 'ff',
      kind: 'image',
      title: '首帧',
      result: { id: 'r1', type: 'image', url: 'nomi-local://first.jpg' },
    })
    const last = node({
      id: 'lf',
      kind: 'image',
      title: '尾帧',
      result: { id: 'r2', type: 'image', url: 'nomi-local://last.jpg' },
    })
    const text = buildDirectorCanvasContext(
      { nodes: [first, last], edges: [], selectedNodeIds: ['ff', 'lf'] },
      [first, last],
    )
    expect(text).toContain('fl2va')
    expect(text).toContain('first_frame')
  })
})
