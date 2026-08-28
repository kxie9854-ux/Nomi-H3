import { describe, expect, it } from 'vitest'
import { pickExternalGraphFocus } from './externalGraphFocus'

describe('pickExternalGraphFocus', () => {
  it('fits when MCP drops several new nodes onto an empty canvas', () => {
    expect(pickExternalGraphFocus([], [
      { id: 'a', kind: 'image', categoryId: 'shots' },
      { id: 'b', kind: 'video', categoryId: 'shots' },
    ])).toEqual({ nodeId: 'b', categoryId: 'shots', mode: 'fit' })
  })

  it('focuses a node that just gained a result', () => {
    expect(pickExternalGraphFocus(
      [{ id: 'v', kind: 'video', categoryId: 'shots' }],
      [{ id: 'v', kind: 'video', categoryId: 'shots', result: { url: 'nomi-local://x.mp4' } }],
    )).toEqual({ nodeId: 'v', categoryId: 'shots', mode: 'focus' })
  })
})
