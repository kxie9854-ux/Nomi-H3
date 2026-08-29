import { describe, expect, it } from 'vitest'

import { nodeHasRecoverableTask, taskIdentityFromNode } from './generationTaskState'
import type { CanvasNode } from './canvasGraph'

function node(overrides: Partial<CanvasNode>): CanvasNode {
  return { id: 'a', kind: 'image', title: 'test', position: { x: 0, y: 0 }, ...overrides }
}

describe('nodeHasRecoverableTask', () => {
  it('resumes running and recoverable tasks', () => {
    expect(nodeHasRecoverableTask(node({ status: 'running', runs: [{ taskId: 't' }] }), 'codex-local')).toBe(true)
    expect(nodeHasRecoverableTask(node({ status: 'recoverable', runs: [{ taskId: 't' }] }), 'codex-local')).toBe(true)
  })

  it('does not resume a provider-declared terminal failure, so retry may submit a new task', () => {
    expect(nodeHasRecoverableTask(node({
      status: 'error',
      runs: [{ taskId: 'old', status: 'error', completedAt: 123 }],
    }), 'codex-local')).toBe(false)
  })

  it('keeps incomplete legacy runs and AutoDL result URLs recoverable', () => {
    expect(nodeHasRecoverableTask(node({ kind: 'video', status: 'error', runs: [{ taskId: 't', status: 'error' }] }), 'apimart')).toBe(true)
    expect(nodeHasRecoverableTask(node({
      kind: 'video',
      status: 'error',
      error: 'fetch failed: https://autodl.art/api/v1/comfyui/comfyui_workflow/result/task-1',
    }), 'autodl-art')).toBe(true)
  })
})

describe('taskIdentityFromNode', () => {
  it('does not resume AutoDL local task-${uuid} fallback ids', () => {
    const fake = 'task-7ae3e7b3-120f-4fad-89f2-10872d1ca2ee'
    expect(taskIdentityFromNode(node({
      kind: 'video',
      status: 'recoverable',
      runs: [{ taskId: fake, taskKind: 'image_to_video' }],
    }), 'autodl-art', 'image_to_video')).toBeNull()
  })

  it('still resumes a real AutoDL UUID', () => {
    expect(taskIdentityFromNode(node({
      kind: 'video',
      status: 'recoverable',
      runs: [{ taskId: 'd80da4e2-c280-4417-9fc6-cc078e357093', taskKind: 'image_to_video' }],
    }), 'autodl-art', 'image_to_video')).toEqual({
      taskId: 'd80da4e2-c280-4417-9fc6-cc078e357093',
      taskKind: 'image_to_video',
    })
  })
})
