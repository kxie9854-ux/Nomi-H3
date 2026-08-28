/** Plain text → Tiptap doc. Shared by MCP text nodes and the canvas text card. */
export function plainTextToTiptapDoc(text: string): {
  type: 'doc'
  content: Array<{ type: 'paragraph'; content?: Array<{ type: 'text'; text: string }> }>
} {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.trim()) return { type: 'doc', content: [] }
  return {
    type: 'doc',
    content: normalized.split('\n').map((line) => (
      line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }
    )),
  }
}
