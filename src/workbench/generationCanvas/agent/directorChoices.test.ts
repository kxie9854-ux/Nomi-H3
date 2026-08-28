import { describe, expect, it } from 'vitest'
import { formatDirectorChoiceReply, parseDirectorChoices, stripOpenFence } from './directorChoices'

describe('parseDirectorChoices', () => {
  it('extracts id|label rows and strips the fence from the body', () => {
    const parsed = parseDirectorChoices([
      '按轻量默认做一镜。',
      ':::choices',
      'accept-defaults | 竖屏 5 秒、静音、一镜成片',
      'multi-shot | 改成多镜故事',
      ':::',
    ].join('\n'))
    expect(parsed.body).toBe('按轻量默认做一镜。')
    expect(parsed.choices).toEqual([
      { id: 'accept-defaults', label: '竖屏 5 秒、静音、一镜成片' },
      { id: 'multi-shot', label: '改成多镜故事' },
    ])
  })

  it('treats a line without a pipe as both id and label', () => {
    const parsed = parseDirectorChoices('问一下\n:::choices\n继续\n:::\n')
    expect(parsed.choices).toEqual([{ id: '继续', label: '继续' }])
  })

  it('hides a fence that is still streaming', () => {
    expect(stripOpenFence('先确认画幅\n:::choices\naccept-defaults | ')).toBe('先确认画幅')
    expect(parseDirectorChoices('先确认画幅\n:::choices\naccept-defaults | ').choices).toEqual([])
  })

  it('turns a strict terminal numbered decision into the existing choices', () => {
    const parsed = parseDirectorChoices('你想采用哪一种？\n1. 竖屏一镜成片\n2、竖屏三镜故事\n(3) 先只做静帧')
    expect(parsed.body).toBe('你想采用哪一种？')
    expect(parsed.choices).toEqual([
      { id: '1', label: '竖屏一镜成片' },
      { id: '2', label: '竖屏三镜故事' },
      { id: '3', label: '先只做静帧' },
    ])
  })

  it('keeps production steps and shot lists as text', () => {
    const steps = '制作步骤如下：\n1. 先出角色定妆\n2. 再出首尾帧\n3. 最后生成视频'
    const shots = '镜头清单\n1. S01 猫看到蝴蝶\n2. S02 猫追逐蝴蝶'
    expect(parseDirectorChoices(steps)).toEqual({ body: steps, choices: [] })
    expect(parseDirectorChoices(shots)).toEqual({ body: shots, choices: [] })
  })

  it('rejects non-terminal, discontinuous, oversized and long numbered lists', () => {
    const nonTerminal = '请选择：\n1. A\n2. B\n补充说明'
    const discontinuous = '请选择：\n1. A\n3. C'
    const oversized = `请选择：\n${Array.from({ length: 6 }, (_, index) => `${index + 1}. 方案 ${index + 1}`).join('\n')}`
    const long = `请选择：\n1. ${'长'.repeat(81)}\n2. 短`
    for (const text of [nonTerminal, discontinuous, oversized, long]) {
      expect(parseDirectorChoices(text)).toEqual({ body: text, choices: [] })
    }
  })

  it('keeps the explicit fence authoritative over numbered text', () => {
    const parsed = parseDirectorChoices('请选择：\n1. 普通列表\n2. 不应兜底\n:::choices\nstable | 正式选项\n:::')
    expect(parsed.choices).toEqual([{ id: 'stable', label: '正式选项' }])
  })
})

describe('formatDirectorChoiceReply', () => {
  it('sends a stable id the director can map back to the gate', () => {
    expect(formatDirectorChoiceReply({ id: 'accept-defaults', label: '用轻量默认继续' }))
      .toBe('选项 accept-defaults：用轻量默认继续')
  })
})
