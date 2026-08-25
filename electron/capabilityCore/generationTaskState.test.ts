import { describe, expect, it } from 'vitest'

import { nodeHasRecoverableTask } from './generationTaskState'

describe('nodeHasRecoverableTask', () => {
  it('resumes running and recoverable tasks', () => {
    expect(nodeHasRecoverableTask({ id: 'a', kind: 'image', status: 'running', runs: [{ taskId: 't' }] }, 'codex-local')).toBe(true)
    expect(nodeHasRecoverableTask({ id: 'a', kind: 'image', status: 'recoverable', runs: [{ taskId: 't' }] }, 'codex-local')).toBe(true)
  })

  it('does not resume a provider-declared terminal failure, so retry may submit a new task', () => {
    expect(nodeHasRecoverableTask({
      id: 'a',
      kind: 'image',
      status: 'error',
      runs: [{ taskId: 'old', status: 'error', completedAt: 123 }],
    }, 'codex-local')).toBe(false)
  })

  it('keeps incomplete legacy runs and AutoDL result URLs recoverable', () => {
    expect(nodeHasRecoverableTask({ id: 'a', kind: 'video', status: 'error', runs: [{ taskId: 't', status: 'error' }] }, 'apimart')).toBe(true)
    expect(nodeHasRecoverableTask({
      id: 'a',
      kind: 'video',
      status: 'error',
      error: 'fetch failed: https://autodl.art/api/v1/comfyui/comfyui_workflow/result/task-1',
    }, 'autodl-art')).toBe(true)
  })
})
