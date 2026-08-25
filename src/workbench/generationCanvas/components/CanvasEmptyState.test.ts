import { describe, expect, it, vi } from 'vitest'
import { FOCUS_DIRECTOR_COMPOSER_EVENT } from '../nodes/nodeSizing'
import { openDirectorFromEmptyCanvas } from './openDirectorFromEmptyCanvas'

describe('director empty-canvas entry', () => {
  it('opens Codex and focuses the composer without creating a node', () => {
    const setCollapsed = vi.fn()
    const dispatch = vi.fn()
    openDirectorFromEmptyCanvas(setCollapsed, dispatch)
    expect(setCollapsed).toHaveBeenCalledWith(false)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0][0]).toBeInstanceOf(Event)
    expect(dispatch.mock.calls[0][0].type).toBe(FOCUS_DIRECTOR_COMPOSER_EVENT)
  })
})

