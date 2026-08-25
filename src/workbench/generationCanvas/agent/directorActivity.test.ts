import { describe, expect, it } from 'vitest'
import { humanizeDirectorActivity } from './directorActivity'

describe('humanizeDirectorActivity', () => {
  it('turns generate/add into one status line and hides approvals and list calls', () => {
    expect(humanizeDirectorActivity({ tool: 'nomi_generate', text: 'intent=video' })).toBe('正在出视频')
    expect(humanizeDirectorActivity({ tool: 'nomi_add_nodes' })).toBe('正在往画布落卡片')
    expect(humanizeDirectorActivity({ tool: 'nomi_assemble_timeline' })).toBe('正在把成片排上时间轴')
    expect(humanizeDirectorActivity({ type: 'approval', tool: 'command' })).toBeNull()
    expect(humanizeDirectorActivity({ tool: 'nomi_read_canvas' })).toBeNull()
    expect(humanizeDirectorActivity({ tool: 'nomi_list_models' })).toBeNull()
  })
})
