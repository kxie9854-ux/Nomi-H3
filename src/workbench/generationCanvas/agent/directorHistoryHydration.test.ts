import { describe, expect, it } from 'vitest'
import {
  isCurrentDirectorHistoryResponse,
  mergeDirectorHistoryLines,
} from './directorHistoryHydration'

describe('director history hydration', () => {
  it('rejects a late project A response after switching to project B', () => {
    expect(isCurrentDirectorHistoryResponse({
      request: { generation: 3, projectId: 'project-a' },
      latestGeneration: 4,
      activeProjectId: 'project-b',
      responseProjectId: 'project-a',
    })).toBe(false)
  })

  it('accepts only a response whose generation and project identities all match', () => {
    expect(isCurrentDirectorHistoryResponse({
      request: { generation: 4, projectId: 'project-b' },
      latestGeneration: 4,
      activeProjectId: 'project-b',
      responseProjectId: 'project-b',
    })).toBe(true)
  })

  it('deduplicates an optimistic user line that already reached thread history', () => {
    expect(mergeDirectorHistoryLines(
      [{ id: 'official-user', role: 'user', text: '继续审片' }],
      [
        { id: 'local-user', role: 'user', text: '继续审片' },
        { id: 'local-assistant', role: 'assistant', text: '' },
      ],
    )).toEqual([
      { id: 'official-user', role: 'user', text: '继续审片', origin: 'history' },
      { id: 'local-assistant', role: 'assistant', text: '' },
    ])
  })

  it('uses stable item ids and keeps newer live text for the same id', () => {
    expect(mergeDirectorHistoryLines(
      [{ id: 'agent-1', role: 'assistant', text: '正在' }],
      [{ id: 'agent-1', role: 'assistant', text: '正在整理镜头' }],
    )).toEqual([{ id: 'agent-1', role: 'assistant', text: '正在整理镜头' }])
  })
})
