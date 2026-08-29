// 生成任务的持久化状态与画布输入解析。
// 从 core.ts 抽出，避免编排层继续膨胀；所有传输仍只调用 core.generateOnProject（无并行入口）。
import { AUTODL_ART_VENDOR_SEED } from '../catalog/autodlArtH3'
import type { CanvasSnapshot } from './canvasGraph'

export type GenerateIntent = 'image' | 'video' | 'text' | 'audio'

export type TaskResultLike = {
  id?: string
  status?: string
  assets?: Array<{
    type?: string
    url?: string
    thumbnailUrl?: string | null
    providerUrl?: string | null
    assetId?: string | null
    text?: string | null
  }>
  raw?: unknown
  error?: string
}

export type RunTaskFn = (payload: { vendor: string; request: unknown }) => Promise<TaskResultLike>
export type FetchTaskResultFn = (payload: {
  taskId: string
  vendor: string
  taskKind: string
  prompt: string
  modelKey: string
  projectId?: string
}) => Promise<{ result: TaskResultLike }>

export function isTerminalTaskStatus(status: string | undefined): boolean {
  return status === 'succeeded' || status === 'failed'
}

export type GenerationContinuationStatus = 'running' | 'recoverable'

export function delayTaskPoll(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const REFERENCE_EDGE_MODES = new Set(['reference', 'character_ref', 'style_ref', 'composition_ref'])

function sourceNodeAssetUrl(node: { result?: unknown; references?: unknown; url?: unknown } | undefined): string {
  if (!node) return ''
  const result = node.result as { url?: unknown } | undefined
  if (typeof result?.url === 'string' && result.url) return result.url
  if (typeof node.url === 'string' && node.url) return node.url
  const refs = node.references
  if (Array.isArray(refs) && typeof refs[0] === 'string' && refs[0]) return refs[0]
  return ''
}

/** 指向 nodeId 的参考类入边的源节点（与 referencesFromEdges 同一组边判据）。 */
export function referenceSourceNodes(snapshot: CanvasSnapshot, nodeId: string): CanvasSnapshot['nodes'] {
  const sources = (snapshot.edges || [])
    .filter((edge) => edge.target === nodeId && REFERENCE_EDGE_MODES.has(edge.mode || 'reference'))
    .map((edge) => snapshot.nodes.find((node) => node.id === edge.source))
  return sources.filter((node): node is CanvasSnapshot['nodes'][number] => Boolean(node))
}

/** 从指向 nodeId 的参考类入边解析参考图 URL（按 order 排、去重）。 */
export function referencesFromEdges(snapshot: CanvasSnapshot, nodeId: string): string[] {
  const incoming = (snapshot.edges || [])
    .filter((edge) => edge.target === nodeId && REFERENCE_EDGE_MODES.has(edge.mode || 'reference'))
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const urls: string[] = []
  for (const edge of incoming) {
    const url = sourceNodeAssetUrl(snapshot.nodes.find((node) => node.id === edge.source))
    if (url && !urls.includes(url)) urls.push(url)
  }
  return urls
}

/** 指向 nodeId 的首尾帧入边源资产。 */
export function frameUrlsFromEdges(snapshot: CanvasSnapshot, nodeId: string): { first: string; last: string } {
  let first = ''
  let last = ''
  for (const edge of snapshot.edges || []) {
    if (edge.target !== nodeId) continue
    const url = sourceNodeAssetUrl(snapshot.nodes.find((node) => node.id === edge.source))
    if (!url) continue
    if (edge.mode === 'first_frame' && !first) first = url
    if (edge.mode === 'last_frame' && !last) last = url
  }
  return { first, last }
}

export function extractTextFromRaw(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    if (typeof record.content === 'string') return record.content
    const choices = record.choices as Array<{ message?: { content?: unknown } }> | undefined
    const content = choices?.[0]?.message?.content
    if (typeof content === 'string') return content
  }
  return ''
}

export function setNodeStatusInSnapshot(snapshot: CanvasSnapshot, nodeId: string, status: string, error?: string): CanvasSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => (node.id === nodeId ? { ...node, status, ...(error ? { error } : {}) } : node)),
  }
}

export type PersistedTaskIdentity = { taskId: string; taskKind: string }

/** Resume only genuinely in-flight/recoverable work. A provider-declared terminal failure has a
 * completed run and must allow an explicit retry to submit a fresh task. Legacy AutoDL failures
 * that embedded the result endpoint in the error remain recoverable for one-time migration. */
export function nodeHasRecoverableTask(
  node: CanvasSnapshot['nodes'][number],
  vendor: string,
): boolean {
  if (node.status === 'running' || node.status === 'recoverable') return true
  const progress = node.progress && typeof node.progress === 'object' ? node.progress as Record<string, unknown> : null
  if (typeof progress?.taskId === 'string' && progress.taskId.trim()) return true
  const runs = Array.isArray(node.runs) ? node.runs as Array<Record<string, unknown>> : []
  if (runs.some((run) => (
    typeof run.taskId === 'string'
    && run.taskId.trim()
    && typeof run.completedAt !== 'number'
    && !['success', 'succeeded', 'failed'].includes(String(run.status || '').toLowerCase())
  ))) return true
  return vendor === AUTODL_ART_VENDOR_SEED.key
    && typeof node.error === 'string'
    && /\/api\/v1\/comfyui\/comfyui_workflow\/result\/[^\s:?#/]+/.test(node.error)
}

export function taskIdentityFromNode(
  node: CanvasSnapshot['nodes'][number],
  vendor: string,
  fallbackTaskKind: string,
): PersistedTaskIdentity | null {
  const runs = Array.isArray(node.runs) ? node.runs as Array<Record<string, unknown>> : []
  const progress = node.progress && typeof node.progress === 'object' ? node.progress as Record<string, unknown> : null
  const result = node.result && typeof node.result === 'object' ? node.result as Record<string, unknown> : null
  const candidates: Array<{ taskId: unknown; taskKind?: unknown }> = [
    ...runs.map((run) => ({ taskId: run.taskId, taskKind: run.taskKind })),
    { taskId: progress?.taskId, taskKind: progress?.taskKind },
    { taskId: result?.taskId, taskKind: result?.taskKind },
  ]
  for (const candidate of candidates) {
    const taskId = typeof candidate.taskId === 'string' ? candidate.taskId.trim() : ''
    if (taskId) {
      return {
        taskId,
        taskKind: typeof candidate.taskKind === 'string' && candidate.taskKind.trim()
          ? candidate.taskKind.trim()
          : fallbackTaskKind,
      }
    }
  }
  if (vendor === AUTODL_ART_VENDOR_SEED.key && typeof node.error === 'string') {
    const matched = node.error.match(/\/api\/v1\/comfyui\/comfyui_workflow\/result\/([^\s:?#/]+)/)
    const taskId = matched?.[1] ? decodeURIComponent(matched[1]) : ''
    if (taskId) return { taskId, taskKind: fallbackTaskKind }
  }
  return null
}

/** 首调一拿到 provider taskId 就落盘；轮询断线后才能续查而不是重新下单。 */
export function setNodeTaskInSnapshot(
  snapshot: CanvasSnapshot,
  nodeId: string,
  identity: PersistedTaskIdentity,
  status: GenerationContinuationStatus,
  error?: string,
): CanvasSnapshot {
  const now = Date.now()
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => {
      if (node.id !== nodeId) return node
      const oldRuns = Array.isArray(node.runs) ? node.runs as Array<Record<string, unknown>> : []
      const existing = oldRuns.find((run) => run.taskId === identity.taskId)
      const nextRun = {
        ...(existing || {}),
        id: typeof existing?.id === 'string' ? existing.id : `provider-${identity.taskId}`,
        taskId: identity.taskId,
        taskKind: identity.taskKind,
        status,
        startedAt: typeof existing?.startedAt === 'number' ? existing.startedAt : now,
        updatedAt: now,
        ...(error ? { error } : {}),
      }
      const { error: _oldError, progress: _oldProgress, ...rest } = node
      return {
        ...rest,
        status,
        runs: [nextRun, ...oldRuns.filter((run) => run.taskId !== identity.taskId)],
        ...(status === 'running'
          ? { progress: { taskId: identity.taskId, taskKind: identity.taskKind, phase: 'provider-task', updatedAt: now } }
          : {}),
        ...(error ? { error } : {}),
      }
    }),
  }
}

/** 把生成结果落回目标节点（success/error 态 + result 对象）。 */
export function writeResultToSnapshot(
  snapshot: CanvasSnapshot,
  nodeId: string,
  result: TaskResultLike,
  intent: GenerateIntent,
): CanvasSnapshot {
  const primary = (result.assets || [])[0]
  const text = intent === 'text' ? extractTextFromRaw(result.raw) : (typeof primary?.text === 'string' ? primary.text : '')
  const hasOutput = Boolean(primary || text)
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((item) => item.id === nodeId
      ? (() => {
          const { error: _oldError, progress: _oldProgress, ...rest } = item
          const oldRuns = Array.isArray(item.runs) ? item.runs as Array<Record<string, unknown>> : []
          const runStatus = result.status === 'succeeded' ? 'success' : result.status === 'failed' ? 'error' : result.status
          const nextRuns = result.id
            ? oldRuns.map((run) => run.taskId === result.id
              ? {
                  ...run,
                  status: runStatus,
                  updatedAt: Date.now(),
                  ...(isTerminalTaskStatus(result.status) ? { completedAt: Date.now() } : {}),
                  ...(result.error ? { error: result.error } : {}),
                }
              : run)
            : oldRuns
          return {
            ...rest,
            status: result.status === 'succeeded' ? 'success' : result.status === 'failed' ? 'error' : (typeof item.status === 'string' ? item.status : 'idle'),
            ...(nextRuns.length ? { runs: nextRuns } : {}),
            ...(result.status === 'failed' && result.error ? { error: result.error } : {}),
            ...(hasOutput ? {
              result: {
                id: result.id || `result-${nodeId}`,
                type: intent === 'video' ? 'video' : intent === 'audio' ? 'audio' : intent === 'text' ? 'text' : 'image',
                ...(primary?.url ? { url: primary.url } : {}),
                ...(primary?.thumbnailUrl ? { thumbnailUrl: primary.thumbnailUrl } : {}),
                ...(primary?.providerUrl ? { providerUrl: primary.providerUrl } : {}),
                ...(text ? { text } : {}),
                ...(primary?.assetId ? { assetId: primary.assetId } : {}),
                ...(result.id ? { taskId: result.id } : {}),
                createdAt: Date.now(),
              },
            } : {}),
          }
        })()
      : item),
  }
}
