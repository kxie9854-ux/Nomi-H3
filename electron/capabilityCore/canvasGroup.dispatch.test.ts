import { describe, expect, it, vi } from 'vitest'

import { dispatch, RpcError, type DispatchContext } from './dispatcher'
import { emptyCanvasSnapshot, addNodes, type CanvasSnapshot } from './canvasGraph'

function context(snapshot: CanvasSnapshot): { ctx: DispatchContext; read: () => CanvasSnapshot } {
  let current = snapshot
  return {
    read: () => current,
    ctx: {
      runTask: vi.fn(),
      makeGateway: () => ({
        readDoc: async () => current,
        apply: async (next) => { current = next },
        confirmSpend: async () => null,
        confirmPlan: async () => true,
      }),
      productionRuns: {
        createDraft: vi.fn(), readProjection: vi.fn(), readEvents: vi.fn(),
        readArtifactProjection: vi.fn(), readFull: vi.fn(), command: vi.fn(),
      },
    },
  }
}

describe('canvas.freezeNodes dispatch', () => {
  it('freezes a character card that already has a still', async () => {
    const built = addNodes(emptyCanvasSnapshot(), [
      { kind: 'character', title: '猫', assetUrl: 'nomi-local://asset/p/cat.png' },
    ])
    const harness = context(built.snapshot)
    const result = await dispatch('canvas.freezeNodes', {
      projectId: 'project-1', nodeIds: built.ids,
    }, harness.ctx) as { frozen: string[]; skipped: unknown[] }
    expect(result.frozen).toEqual(built.ids)
    expect(result.skipped).toEqual([])
    expect(harness.read().nodes[0].meta?.frozen).toMatchObject({ by: 'user' })
  })

  it('rejects an empty id list before touching the gateway', async () => {
    const makeGateway = vi.fn()
    const harness = context(emptyCanvasSnapshot())
    harness.ctx.makeGateway = makeGateway
    await expect(dispatch('canvas.freezeNodes', {
      projectId: 'project-1', nodeIds: [],
    }, harness.ctx)).rejects.toMatchObject<RpcError>({ httpStatus: 400 })
    expect(makeGateway).not.toHaveBeenCalled()
  })
})

describe('canvas.groupNodes dispatch', () => {
  it('routes a valid request through the project gateway', async () => {
    const built = addNodes(emptyCanvasSnapshot(), [{ kind: 'image' }, { kind: 'video' }])
    const harness = context(built.snapshot)
    const result = await dispatch('canvas.groupNodes', {
      projectId: 'project-1', nodeIds: built.ids, name: '镜头 1',
    }, harness.ctx) as { created: boolean; group: { name: string } }
    expect(result.created).toBe(true)
    expect(result.group.name).toBe('镜头 1')
    expect(harness.read().groups).toHaveLength(1)
  })

  it('rejects fewer than two ids before touching the gateway', async () => {
    const makeGateway = vi.fn()
    const harness = context(emptyCanvasSnapshot())
    harness.ctx.makeGateway = makeGateway
    await expect(dispatch('canvas.groupNodes', {
      projectId: 'project-1', nodeIds: ['one'], name: '单节点',
    }, harness.ctx)).rejects.toMatchObject<RpcError>({ httpStatus: 400 })
    expect(makeGateway).not.toHaveBeenCalled()
  })
})
