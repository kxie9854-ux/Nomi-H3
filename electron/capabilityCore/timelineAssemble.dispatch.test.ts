import { describe, expect, it, vi } from 'vitest'
import { dispatch, RpcError, type DispatchContext } from './dispatcher'

function ctx(over: Partial<DispatchContext> = {}): DispatchContext {
  return {
    runTask: vi.fn(),
    makeGateway: vi.fn(),
    productionRuns: {
      createDraft: vi.fn(),
      readProjection: vi.fn(),
      readEvents: vi.fn(),
      readArtifactProjection: vi.fn(),
      readFull: vi.fn(),
      command: vi.fn(),
    },
    ...over,
  }
}

describe('timeline.assemble dispatch', () => {
  it('refuses when the Nomi window is not arranging this project', async () => {
    try {
      await dispatch('timeline.assemble', { projectId: 'project-1' }, ctx())
      expect.fail('expected 409')
    } catch (error) {
      expect(error).toBeInstanceOf(RpcError)
      expect((error as RpcError).httpStatus).toBe(409)
      expect((error as RpcError).message).toContain('打开这个项目后再排成片')
    }
  })

  it('forwards projectId and nodeIds to the renderer arrange hook', async () => {
    const arrangeTimeline = vi.fn(async () => ({ arranged: 2, total: 2, skipped: [] }))
    const result = await dispatch(
      'timeline.assemble',
      { projectId: 'project-1', nodeIds: ['node-a', 'node-b'] },
      ctx({ arrangeTimeline }),
    )
    expect(arrangeTimeline).toHaveBeenCalledWith({ projectId: 'project-1', nodeIds: ['node-a', 'node-b'] })
    expect(result).toEqual({ arranged: 2, total: 2, skipped: [] })
  })
})
