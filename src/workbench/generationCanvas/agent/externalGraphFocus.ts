export type GraphFocusNode = { id: string; kind?: string; categoryId?: string; result?: { url?: string } | null }

export function pickExternalGraphFocus(
  before: readonly GraphFocusNode[],
  after: readonly GraphFocusNode[],
): { nodeId: string; categoryId: string; mode: 'focus' | 'fit' } | null {
  const beforeById = new Map(before.map((node) => [node.id, node]))
  const added = after.filter((node) => !beforeById.has(node.id))
  const gainedResult = after.filter((node) => node.result?.url && !beforeById.get(node.id)?.result?.url)
  const primary = gainedResult.at(-1)
    || added.filter((node) => node.kind === 'video').at(-1)
    || added.at(-1)
  if (!primary) return null
  const categoryId = primary.categoryId || 'shots'
  if (added.length > 1 && gainedResult.length === 0) return { nodeId: primary.id, categoryId, mode: 'fit' }
  return { nodeId: primary.id, categoryId, mode: 'focus' }
}
