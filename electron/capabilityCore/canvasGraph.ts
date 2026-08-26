// 能力核 · 纯图操作领域层（见 docs/plan/2026-06-20-capability-core-headless-exposure.md）。
//
// 这是「外部 agent / CLI / MCP 驱动 Nomi 画布」的最底层：把对画布工程的语义操作
// （建节点 / 连线 / 改提示词 / 删节点 / 读画布）实现成**纯函数**——输入一份
// GenerationCanvasSnapshot（即 project.json 的 payload.generationCanvas，纯 JSON），
// 输出新的 snapshot + 受影响的 id。零 electron、零 store、零副作用，故可在纯 Node 单测。
//
// 真相源铁律（P1）：节点/边的形状以 renderer 的 generationCanvasTypes 为准；这里**不复制
// 任何业务逻辑**——建节点经**共用工厂** `canvasNodeFactory`（与渲染层 store.addNode 同一份纯函数），
// 落点经**共用布局** `canvasNodeLayout`（与渲染层 resolveInsertionPosition / trajectoryLayout 同一份数学），
// per-kind 几何/语义注入自 `nodeKindDomain`（由等价测试钉死 === src registry）。故 MCP 建的节点与
// UI 建的节点**字段级等价**（meta/categoryId/shotIndex/size 全齐），不再是缺字段的「二等公民」。
import { randomUUID } from 'node:crypto'
import { ANCHOR_META_KEYS, isVisualAnchorKind } from './anchorBible'
import { plainTextToTiptapDoc } from './plainTextDoc'
import { buildCanvasNodes, type CanvasNodeFactorySpec, type CanvasNodeRecord, type NodeFactoryDeps } from './canvasNodeFactory'
import { layoutBatchWith, type NodeBox } from './canvasNodeLayout'
import {
  nodeKindDefaultCategory,
  nodeKindDefaultSize,
  nodeKindFootprint,
  nodeKindIsShotNumbered,
  nodeKindNextShotIndex,
} from './nodeKindDomain'

/** 画布快照（project.json payload.generationCanvas 的纯 JSON 形状）。 */
export type CanvasSnapshot = {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  groups?: CanvasGroup[]
  selectedNodeIds?: string[]
}

export type CanvasNode = {
  id: string
  kind: string
  title: string
  position: { x: number; y: number }
  size?: { width: number; height: number }
  prompt?: string
  references?: string[]
  status?: string
  categoryId?: string
  meta?: Record<string, unknown>
  [key: string]: unknown
}

export type CanvasEdge = {
  id: string
  source: string
  target: string
  mode?: string
  order?: number
}

/** 与 renderer NodeGroup 同形的可持久化分组；能力核只操作分组所需字段，其余声明原样保留。 */
export type CanvasGroup = {
  id: string
  name: string
  categoryId: string
  nodeIds: string[]
  createdAt: number
  updatedAt: number
  [key: string]: unknown
}

/** 建节点入参——语义字段 + 可选模型身份；几何/分类/镜号由共用工厂补齐（与 UI 同）。 */
export type NodeSpec = {
  kind?: string
  title?: string
  prompt?: string
  x?: number
  y?: number
  references?: string[]
  /** 外部调用方（MCP）给的模型身份——工厂绑进 meta 的解析器可见四件（同 UI 身份部分）。非法值原样存。 */
  vendor?: string
  modelKey?: string
  /** nomi_import_asset 返回的 nomi-local://，绑成节点产物（BGM / 导入静帧）。其它 scheme 忽略。 */
  assetUrl?: string
}

export type ConnectionSpec = {
  source: string
  target: string
  mode?: string
}

function attachImportedAsset(node: CanvasNodeRecord, assetUrl: string | undefined): CanvasNodeRecord {
  const url = typeof assetUrl === 'string' ? assetUrl.trim() : ''
  if (!url.startsWith('nomi-local://')) return node
  const type = node.kind === 'audio' ? 'audio' : node.kind === 'video' || node.kind === 'clip' ? 'video' : 'image'
  return {
    ...node,
    status: 'success',
    result: {
      id: `imported:${node.id}`,
      type,
      url,
      taskKind: 'asset',
      createdAt: Date.now(),
    },
  } as CanvasNodeRecord
}

const VALID_EDGE_MODES = new Set([
  'reference',
  'first_frame',
  'last_frame',
  'style_ref',
  'character_ref',
  'composition_ref',
])

let idCounter = 0

/**
 * 生成稳定且不撞的 id。不可用 Date.now()/Math.random() 之外的来源——这里用
 * crypto.randomUUID 保证跨进程唯一（撞 id 是「文字 clip 撞 id」那类 P0 的根因，见
 * clip-timeline-walkthrough 记忆），prefix 标明类型便于排错。
 */
function genId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${randomUUID().slice(0, 8)}-${idCounter.toString(36)}`
}

function cloneSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({ ...node })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
    ...(snapshot.groups ? { groups: snapshot.groups.map((group) => ({ ...group, nodeIds: [...group.nodeIds] })) } : {}),
    ...(snapshot.selectedNodeIds ? { selectedNodeIds: [...snapshot.selectedNodeIds] } : {}),
  }
}

/** 空快照（新工程 / payload 缺 generationCanvas 时的兜底）。 */
export function emptyCanvasSnapshot(): CanvasSnapshot {
  return { nodes: [], edges: [], groups: [], selectedNodeIds: [] }
}

/** 把任意 unknown（来自 project.json）规整成可操作的 CanvasSnapshot，坏数据降级为空。 */
export function normalizeSnapshot(value: unknown): CanvasSnapshot {
  if (!value || typeof value !== 'object') return emptyCanvasSnapshot()
  const raw = value as Record<string, unknown>
  const nodes = Array.isArray(raw.nodes) ? (raw.nodes as CanvasNode[]) : []
  const edges = Array.isArray(raw.edges) ? (raw.edges as CanvasEdge[]) : []
  return {
    nodes: nodes.filter((node) => node && typeof node.id === 'string'),
    edges: edges.filter((edge) => edge && typeof edge.id === 'string' && typeof edge.source === 'string' && typeof edge.target === 'string'),
    groups: Array.isArray(raw.groups)
      ? raw.groups.flatMap((candidate) => {
          if (!candidate || typeof candidate !== 'object') return []
          const group = candidate as Record<string, unknown>
          if (typeof group.id !== 'string' || typeof group.name !== 'string' || !Array.isArray(group.nodeIds)) return []
          return [{
            ...group,
            id: group.id,
            name: group.name,
            categoryId: typeof group.categoryId === 'string' && group.categoryId ? group.categoryId : 'shots',
            nodeIds: group.nodeIds.filter((id): id is string => typeof id === 'string'),
            createdAt: typeof group.createdAt === 'number' ? group.createdAt : 0,
            updatedAt: typeof group.updatedAt === 'number' ? group.updatedAt : 0,
          } as CanvasGroup]
        })
      : [],
    selectedNodeIds: Array.isArray(raw.selectedNodeIds) ? (raw.selectedNodeIds as string[]) : [],
  }
}

/** 读画布：返回精简到「外部 agent 需要据此决策」的字段，不灌完整 raw（R2 极简）。 */
export function readCanvas(snapshot: CanvasSnapshot): {
  nodes: Array<{ id: string; kind: string; title: string; prompt: string; status: string; position: { x: number; y: number }; hasResult: boolean }>
  edges: Array<{ id: string; source: string; target: string; mode: string }>
  groups: Array<{ id: string; name: string; categoryId: string; nodeIds: string[] }>
} {
  return {
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title || '',
      prompt: typeof node.prompt === 'string' ? node.prompt : '',
      status: typeof node.status === 'string' ? node.status : 'idle',
      position: node.position || { x: 0, y: 0 },
      hasResult: Boolean(node.result),
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      mode: edge.mode || 'reference',
    })),
    groups: (snapshot.groups || []).map((group) => ({
      id: group.id,
      name: group.name,
      categoryId: group.categoryId,
      nodeIds: [...group.nodeIds],
    })),
  }
}

export type GroupNodesResult = {
  snapshot: CanvasSnapshot
  group: CanvasGroup | null
  created: boolean
  skipped: Array<{ nodeId: string; reason: string }>
}

/**
 * 把一批既有节点收进一个组。分组不能跨分类；分类从第一个存在的节点推导，调用方不用理解内部 categoryId。
 * 同名 + 同成员集合的重复请求直接复用原组；节点已在别组时按 UI 语义“抢入”新组，并同步 node.groupId。
 */
export function groupNodes(snapshot: CanvasSnapshot, nodeIds: string[], name: string): GroupNodesResult {
  const next = cloneSnapshot(snapshot)
  const requested = Array.from(new Set(nodeIds.map((id) => String(id || '').trim()).filter(Boolean)))
  const nodeById = new Map(next.nodes.map((node) => [node.id, node]))
  const skipped: GroupNodesResult['skipped'] = []
  const existing = requested.flatMap((nodeId) => {
    const node = nodeById.get(nodeId)
    if (!node) {
      skipped.push({ nodeId, reason: '节点不存在' })
      return []
    }
    return [node]
  })
  const categoryId = existing[0]?.categoryId || 'shots'
  const members = existing.filter((node) => {
    if ((node.categoryId || 'shots') === categoryId) return true
    skipped.push({ nodeId: node.id, reason: '节点分类不同' })
    return false
  })
  const memberIds = members.map((node) => node.id)
  const normalizedName = String(name || '').trim()
  if (!normalizedName || memberIds.length < 2) return { snapshot, group: null, created: false, skipped }

  const memberSet = new Set(memberIds)
  const reusable = (next.groups || []).find((group) => (
    group.name.trim() === normalizedName
    && group.categoryId === categoryId
    && group.nodeIds.length === memberSet.size
    && group.nodeIds.every((id) => memberSet.has(id))
  ))
  if (reusable) return { snapshot, group: reusable, created: false, skipped }

  const now = Date.now()
  const group: CanvasGroup = {
    id: genId(`group-${categoryId}`),
    name: normalizedName,
    categoryId,
    nodeIds: memberIds,
    createdAt: now,
    updatedAt: now,
  }
  next.groups = (next.groups || []).map((candidate) => ({
    ...candidate,
    nodeIds: candidate.nodeIds.filter((id) => !memberSet.has(id)),
    ...(candidate.nodeIds.some((id) => memberSet.has(id)) ? { updatedAt: now } : {}),
  }))
  next.groups.push(group)
  next.nodes = next.nodes.map((node) => memberSet.has(node.id) ? { ...node, groupId: group.id } : node)
  next.selectedNodeIds = memberIds
  return { snapshot: next, group, created: true, skipped }
}

// 能力核侧的工厂依赖注入：几何/分类/镜号全走 nodeKindDomain 纯表，与渲染层注入 src 真函数同一份工厂逻辑。
// resolveDefaultTitle **故意回空串**（不注英文标题）：main 进程无 i18n，若这里烘死 'Text'/'Image' 英文标题
// 会原样落进 project.json → zh-CN 用户看到英文卡名（MCP 省略 title 时）。空标题的本地化归**渲染时兜底**所有：
// 卡片渲染点已一律 `node.title || t(...)`（BaseGenerationNode NodeInlineImageTitle / AudioStripNode getDisplayTitle /
// Character·Scene·PropCardNode 的 EditableNodeTitle placeholder），故省略 title 存空 → UI 用当前 locale 补默认名。
// 渲染层注入 src i18n 真函数不受影响（它有 locale，直接给本地化默认名）。故两路仍字段级等价——除 id/落点与
// 「默认标题」这一 headless-i18n 策略差（一个存空待渲染补、一个即时本地化，落到用户眼里同为本地化默认名）。
const ELECTRON_NODE_FACTORY_DEPS: NodeFactoryDeps = {
  createId: () => genId('node'),
  resolveSize: nodeKindDefaultSize,
  resolveDefaultTitle: () => '',
  resolveCategory: nodeKindDefaultCategory,
  isShotNumbered: nodeKindIsShotNumbered,
  nextShotIndex: nodeKindNextShotIndex,
}

/**
 * 批量建节点（经**共用工厂 + 共用布局**，与渲染层 store.addNode 同一份逻辑）。
 * - 落点：≥2 节点走分层布局（层由 kind 推：参考/关键帧/视频三列，凑不齐退网格）；单节点走碰撞避让。
 *   显式 x/y 永远优先（工厂在 spec 层尊重）。都从已有节点包围盒下方起、不压旧内容。
 * - 字段：meta/categoryId/shotIndex/size 全由工厂补齐 → MCP 节点不再是缺字段的「二等公民」。
 * 返回新快照 + 新建 id（按入参顺序，供后续连线引用）。
 */
export function addNodes(
  snapshot: CanvasSnapshot,
  specs: NodeSpec[],
): { snapshot: CanvasSnapshot; ids: string[] } {
  const next = cloneSnapshot(snapshot)
  if (!specs.length) return { snapshot: next, ids: [] }

  const factorySpecs: CanvasNodeFactorySpec[] = specs.map((spec) => ({
    kind: (spec.kind && spec.kind.trim()) || 'text',
    title: spec.title,
    prompt: spec.prompt,
    references: spec.references,
    vendor: spec.vendor,
    modelKey: spec.modelKey,
    ...(typeof spec.x === 'number' ? { x: spec.x } : {}),
    ...(typeof spec.y === 'number' ? { y: spec.y } : {}),
  }))
  // 缺省落点：已有节点做避让锚（同 UI「新内容落在已有下方、不遮挡」）。显式坐标由工厂优先，布局只补缺省。
  const existingBoxes: NodeBox[] = next.nodes.map((node) => ({
    kind: node.kind,
    position: node.position || { x: 0, y: 0 },
    size: node.size,
  }))
  const positions = layoutBatchWith(nodeKindFootprint, factorySpecs.map((spec) => spec.kind), existingBoxes)

  // 镜号只需既有节点的 shotIndex（工厂纯函数，不吃整节点）；显式投影避开 CanvasNode 的 index signature。
  const existingShotIndexes = next.nodes.map((node) => ({
    shotIndex: typeof node.shotIndex === 'number' ? node.shotIndex : undefined,
  }))
  const built = buildCanvasNodes(factorySpecs, positions, existingShotIndexes, ELECTRON_NODE_FACTORY_DEPS)
    .map((node, index) => attachImportedAsset(node, specs[index]?.assetUrl))
  for (const node of built) {
    // 角色/场景/道具卡自动带上 referenceSheet 标记——它本来就是参考卡，这是 kind 的推论，不是调用方的选项。
    // 为什么必须在这儿打：冻结门（anchorBible.isVisualAnchorNode）同时要 kind 和这个标记，而渲染层落节点
    // 时会写、headless MCP 这条路以前不写 → **MCP 建的定妆卡冻结门根本看不见**，整条「先冻脸再铺镜头」
    // 的一致性护栏在 MCP 路上等于不存在（2026-08-20 L2 走查实测抓出）。derive 不 hardcode，别人加新锚 kind
    // 时改 anchorBible 一处即可。
    const withAnchorMark = isVisualAnchorKind(node.kind)
      ? { ...node, meta: { ...((node as { meta?: Record<string, unknown> }).meta || {}), [ANCHOR_META_KEYS.referenceSheet]: true } }
      : node
    const prompt = typeof withAnchorMark.prompt === 'string' ? withAnchorMark.prompt : ''
    const withTextBody = withAnchorMark.kind === 'text' && prompt.trim()
      ? { ...withAnchorMark, contentJson: plainTextToTiptapDoc(prompt) }
      : withAnchorMark
    next.nodes.push(withTextBody as unknown as CanvasNode)
  }
  return { snapshot: next, ids: built.map((node) => node.id) }
}

/**
 * 批量连线。order 按「该 target 现有入边数」递增赋值（全模式单调、全局插入序）——
 * 与 renderer connectNodes 同一口径（generationCanvasTypes 注释），保住「谁是 character1」。
 * 跳过：端点不存在 / 自环 / 重复（同 source→target 同 mode）。返回新快照 + 新建边 id。
 */
export function connectNodes(
  snapshot: CanvasSnapshot,
  connections: ConnectionSpec[],
): { snapshot: CanvasSnapshot; edgeIds: string[]; skipped: Array<{ connection: ConnectionSpec; reason: string }> } {
  const next = cloneSnapshot(snapshot)
  const nodeIds = new Set(next.nodes.map((node) => node.id))
  const edgeIds: string[] = []
  const skipped: Array<{ connection: ConnectionSpec; reason: string }> = []
  for (const connection of connections) {
    const mode = connection.mode && VALID_EDGE_MODES.has(connection.mode) ? connection.mode : 'reference'
    if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) {
      skipped.push({ connection, reason: '端点节点不存在' })
      continue
    }
    if (connection.source === connection.target) {
      skipped.push({ connection, reason: '不能自连' })
      continue
    }
    const duplicate = next.edges.some(
      (edge) => edge.source === connection.source && edge.target === connection.target && (edge.mode || 'reference') === mode,
    )
    if (duplicate) {
      skipped.push({ connection, reason: '重复连线' })
      continue
    }
    const order = next.edges.filter((edge) => edge.target === connection.target).length
    const id = genId('edge')
    edgeIds.push(id)
    next.edges.push({ id, source: connection.source, target: connection.target, mode, order })
  }
  return { snapshot: next, edgeIds, skipped }
}

/** 改节点提示词（可选改标题）。节点不存在则原样返回（changed=false）。 */
export function setNodePrompt(
  snapshot: CanvasSnapshot,
  nodeId: string,
  prompt: string,
  title?: string,
): { snapshot: CanvasSnapshot; changed: boolean } {
  const index = snapshot.nodes.findIndex((node) => node.id === nodeId)
  if (index < 0) return { snapshot, changed: false }
  const next = cloneSnapshot(snapshot)
  next.nodes[index] = {
    ...next.nodes[index],
    prompt,
    ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
  }
  return { snapshot: next, changed: true }
}

export type FreezeNodesResult = {
  snapshot: CanvasSnapshot
  frozen: string[]
  skipped: Array<{ nodeId: string; reason: string }>
}

function nodeResultUrl(node: CanvasNode): string {
  const result = node.result && typeof node.result === 'object' ? node.result as { url?: unknown } : null
  return typeof result?.url === 'string' ? result.url.trim() : ''
}

function isAlreadyFrozen(node: CanvasNode): boolean {
  const meta = node.meta && typeof node.meta === 'object' ? node.meta : null
  const mark = meta?.[ANCHOR_META_KEYS.frozen]
  if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return false
  const at = (mark as { at?: unknown }).at
  return typeof at === 'number' && Number.isFinite(at) && at > 0
}

/** 给已出图的角色/场景/道具卡打冻结标记。幂等。非锚或没图则跳过。 */
export function freezeNodes(snapshot: CanvasSnapshot, nodeIds: string[], frozenAt = Date.now()): FreezeNodesResult {
  const wanted = Array.from(new Set(nodeIds.map((id) => String(id || '').trim()).filter(Boolean)))
  const next = cloneSnapshot(snapshot)
  const frozen: string[] = []
  const skipped: FreezeNodesResult['skipped'] = []
  for (const nodeId of wanted) {
    const index = next.nodes.findIndex((node) => node.id === nodeId)
    if (index < 0) {
      skipped.push({ nodeId, reason: '节点不存在' })
      continue
    }
    const node = next.nodes[index]
    if (!isVisualAnchorKind(node.kind)) {
      skipped.push({ nodeId, reason: '只有角色/场景/道具卡能冻结定妆' })
      continue
    }
    if (isAlreadyFrozen(node)) {
      frozen.push(nodeId)
      continue
    }
    if (!nodeResultUrl(node)) {
      skipped.push({ nodeId, reason: '还没有定妆图，先生成再冻结' })
      continue
    }
    next.nodes[index] = {
      ...node,
      meta: {
        ...(node.meta && typeof node.meta === 'object' ? node.meta : {}),
        [ANCHOR_META_KEYS.referenceSheet]: true,
        [ANCHOR_META_KEYS.frozen]: { at: frozenAt, by: 'user' },
      },
    }
    frozen.push(nodeId)
  }
  return { snapshot: next, frozen, skipped }
}

/** 删节点 + 其关联边（入边出边都删，避免悬挂边）。返回新快照 + 实删 id。 */
export function deleteNodes(
  snapshot: CanvasSnapshot,
  nodeIds: string[],
): { snapshot: CanvasSnapshot; deleted: string[] } {
  const targetSet = new Set(nodeIds)
  const deleted = snapshot.nodes.filter((node) => targetSet.has(node.id)).map((node) => node.id)
  if (!deleted.length) return { snapshot, deleted: [] }
  const next = cloneSnapshot(snapshot)
  next.nodes = next.nodes.filter((node) => !targetSet.has(node.id))
  next.edges = next.edges.filter((edge) => !targetSet.has(edge.source) && !targetSet.has(edge.target))
  next.groups = (next.groups || []).map((group) => ({
    ...group,
    nodeIds: group.nodeIds.filter((id) => !targetSet.has(id)),
  }))
  if (next.selectedNodeIds) next.selectedNodeIds = next.selectedNodeIds.filter((id) => !targetSet.has(id))
  return { snapshot: next, deleted }
}
