import { describe, expect, it } from 'vitest'
import { plainTextToTiptapDoc } from './plainTextDoc'

describe('plainTextToTiptapDoc', () => {
  it('turns blank input into an empty doc', () => {
    expect(plainTextToTiptapDoc('  ')).toEqual({ type: 'doc', content: [] })
  })

  it('keeps line breaks as paragraphs', () => {
    expect(plainTextToTiptapDoc('一行\n\n二行')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '一行' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '二行' }] },
      ],
    })
  })
})
