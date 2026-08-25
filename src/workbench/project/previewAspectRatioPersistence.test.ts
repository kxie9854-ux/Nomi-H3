import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../workbenchStore'
import {
  readCurrentWorkbenchProjectPayload,
  restoreWorkbenchProjectPayload,
} from './workbenchProjectSession'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'

describe('project preview aspect ratio persistence', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({ previewAspectRatio: '16:9', persistRevision: 0 })
  })

  it('marks a user ratio change dirty and includes it in the project payload', () => {
    useWorkbenchStore.getState().setPreviewAspectRatio('9:16')
    expect(useWorkbenchStore.getState().persistRevision).toBe(1)
    expect(readCurrentWorkbenchProjectPayload().previewAspectRatio).toBe('9:16')
  })

  it('restores the project ratio and does not keep the previous project value', () => {
    const payload = { ...createDefaultWorkbenchProjectPayload(), previewAspectRatio: '4:5' as const }
    restoreWorkbenchProjectPayload(payload)
    expect(useWorkbenchStore.getState().previewAspectRatio).toBe('4:5')
  })
})
