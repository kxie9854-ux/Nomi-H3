// 能力核 · 编排层（见 docs/plan/2026-06-20-capability-core-headless-exposure.md）。
//
// 把纯图操作（canvasGraph）接到真实的工程持久化（projects/repository）与生成引擎（runtime.runTask）。
// 这是「外部 agent / CLI / MCP 驱动 Nomi」的**主进程**单一执行口——所有传输（RPC / 头less host）
// 都调这里，不各自实现一遍（P1）。
//
// 模式说明：本文件实现 **B 模式**（app 关着，直接读写 project.json）。当 app 开着时，
// 工程的内存 store 才是真相、会防抖回盘覆盖文件改动（见 workbenchProjectSession），故 app 开着时
// 图变更必须经运行中实例（A 模式，rpcServer 转发给 renderer），不能在此直写文件。调用方（rpcServer/
// host）负责按「app 是否开着」选模式；本核只管把 B 模式做对、做纯。
//
// 真相源（P1）：generate 不重建 archetype→body——runTask 主进程内部据 catalog mapping + extras
// 自己组装请求体（findExecutableModel / requestPipeline / 资产本地化）。本核只构造高层 TaskRequest。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { listProjects, createProject, readProject } from '../projects/repository'
import { readCatalog } from '../catalog/catalogStore'
import { deriveModelListing, referenceModeForIntent, videoBodyKeysForModel, type ModelListingEntry } from '../catalog/modelCatalogListing'
import { classifyReferenceKeyDetailed } from '../catalog/referenceReachability'
import { desktopT } from '../i18n'
import {
  addNodes,
  connectNodes,
  deleteNodes,
  freezeNodes,
  groupNodes,
  readCanvas,
  setNodePrompt,
  type CanvasSnapshot,
  type ConnectionSpec,
  type NodeSpec,
} from './canvasGraph'
import type { ProjectGateway } from './gateway'
import { verifyAndMaybeRetry, type ShotVerifyDeps, type ShotVerifyOutcome } from './shotVerifyOrchestrate'
import { isVisualAnchorKind, unfrozenAnchorsForShot } from './anchorBible'
import { composeShotPrompt, runFirstHop, shouldRenderLastFrame, shouldUseTwoHop } from './i2vTwoHop'
import { pickFirstFramePainter } from './firstFramePainter'
import { previousShotPromptFor } from './shotOrder'
import { checkImportAsset, contentTypeForExtension } from './importAssetGuard'
import { copyAssetFile } from '../assets/projectAssetStore'
import { AUTODL_ART_H3_MODEL_SEED, AUTODL_ART_VENDOR_SEED, isAutodlArtLocalFallbackTaskId } from '../catalog/autodlArtH3'
import {
  AUTODL_ART_H3_RESOLUTION_REFUSE,
  autodlArtH3RejectReason,
  normalizeAutodlArtH3Resolution,
  prepareAutodlArtH3Params,
} from '../catalog/autodlArtH3Mode'
import { createSpendTrustScope } from './mcpSpendTrust'
import {
  isTerminalTaskStatus,
  delayTaskPoll,
  extractTextFromRaw,
  frameUrlsFromEdges,
  nodeHasRecoverableTask,
  referenceSourceNodes,
  referencesFromEdges,
  setNodeStatusInSnapshot,
  setNodeTaskInSnapshot,
  taskIdentityFromNode,
  writeResultToSnapshot,
  type FetchTaskResultFn,
  type GenerateIntent,
  type PersistedTaskIdentity,
  type RunTaskFn,
  type TaskResultLike,
} from './generationTaskState'
export type { FetchTaskResultFn, GenerateIntent, RunTaskFn } from './generationTaskState'
export { frameUrlsFromEdges, referenceSourceNodes, referencesFromEdges } from './generationTaskState'

/**
 * 审片环 deps 工厂（可选注入，由传输层提供）。**默认不传 = 行为逐字节不变**（batchPlanPreview 渲染层路径、
 * 纯 CLI 评测路径都不受影响）。传了 → 生成成功后 core 调一次 verifyAndMaybeRetry 并把 outcome 挂返回。
 * 领域策略住 shotVerifyOrchestrate（纯）、传输层只注入 deps、core 只透传 outcome——三层干净（方案 §3/§9）。
 *
 * ctx 是 core 在生成时算出的真实上下文（复用首发 grantId + 同 nodeId + 同模型/参数/参考重试的原料）。
 */
export type ShotVerifyDepsContext = {
  projectId: string
  grantId: string
  nodeId: string
  vendor: string
  modelKey: string
  generationKind: string
  nodeKind: string
  basePrompt: string
  params: Record<string, unknown>
  references: string[]
}
export type MakeVerifyDeps = (ctx: ShotVerifyDepsContext) => ShotVerifyDeps

/** Headless/MCP 轮询上限：视频 API 官方建议客户端最多等待 15 分钟，允许环境变量覆盖。 */
export function resolveCapabilityPollTimeoutMs(kind: string, envValue: string | undefined = process.env.NOMI_POLL_TIMEOUT_MS): number {
  const override = Number(envValue)
  if (Number.isFinite(override) && override > 0) return override
  return kind === 'text_to_video' || kind === 'image_to_video' ? 900_000 : 240_000
}

function defaultKindForIntent(intent: GenerateIntent, hasReferences: boolean): string {
  switch (intent) {
    case 'image':
      // 带了参考图 = 图生图（改图），与下面 video 那支对称。
      // 曾经这里无条件回 text_to_image：外部助手（Claude Code / Codex / Cursor）经 MCP 带着参考图调
      // nomi_generate，一律被当**纯文生图**跑 —— 参考图静默丢弃、出一张跟原图毫无关系的新图。
      // 真生成实测抓到（火山 Seedream 与 apimart 两条路都中招）：喂一张「橘猫戴红围巾坐雪景窗台」的
      // 照片说「把围巾改成蓝色」，出来的是另一只白猫的插画。
      return hasReferences ? 'image_edit' : 'text_to_image'
    case 'video':
      return hasReferences ? 'image_to_video' : 'text_to_video'
    case 'audio':
      return 'text_to_audio'
    default:
      return 'chat'
  }
}
// ── 工程级 ─────────────────────────────────────────────────────────────

/**
 * 把**本机文件**导入项目当素材，返回 `nomi-local://` URL（MCP 清单 M2）。
 *
 * 为什么必须有：agent 想拿手绘帧/截图/用户给的参考图当 references，此前只能靠人先在 GUI 里拖进去——
 * 「让 Agent 端到端跑完」在素材侧是断的。导入后返回的 URL 可直接进 nomi_generate 的 references
 * 或当画布节点的源。
 *
 * 安全：判据全在 importAssetGuard（纯函数、逐条单测）——这是「远端 agent 读本机文件」的口子，
 * deny 优先于白名单、且对 realpath 再查一遍（软链逃逸在此断掉）。落盘复用既有 copyAssetFile
 * （不走 Buffer、不另造资产管线，P1）。
 */
export async function importProjectAsset(input: {
  projectId: string
  path: string
  title?: string
}): Promise<{ url: string; name: string; contentType: string; sizeBytes: number }> {
  if (!readProject(input.projectId)) throw new Error(`项目不存在: ${input.projectId}`)
  const raw = String(input.path || '')
  // I/O 先做（realpath 解软链 + stat），判据本身保持纯函数。
  let realPath: string | null = null
  let sizeBytes: number | null = null
  let isFile = false
  try {
    realPath = fs.realpathSync(raw)
    const stat = fs.statSync(realPath)
    sizeBytes = stat.size
    isFile = stat.isFile()
  } catch {
    realPath = null
  }
  const verdict = checkImportAsset({ rawPath: raw, realPath, sizeBytes, isFile })
  if (!verdict.ok) throw new Error(verdict.reason)

  const fileName = (() => {
    const titled = typeof input.title === 'string' ? input.title.trim() : ''
    const base = titled || path.basename(verdict.realPath)
    // 标题不带扩展名时补上真实扩展名（落盘/回读都靠它认类型）。
    return base.toLowerCase().endsWith(verdict.extension) ? base : `${base}${verdict.extension}`
  })()
  const contentType = contentTypeForExtension(verdict.extension)
  const record = (await copyAssetFile(input.projectId, verdict.realPath, fileName, contentType, {
    kind: 'imported',
    source: 'mcp-import',
  })) as { name?: string; data?: { url?: string; size?: number } }
  const url = record?.data?.url
  if (!url) throw new Error('素材已复制但没拿到可引用的地址，请重试。')
  return {
    url,
    name: record.name || fileName,
    contentType,
    sizeBytes: record.data?.size ?? sizeBytes ?? 0,
  }
}

export function listAllProjects(): Array<{ id: string; name: string; updatedAt: number }> {
  return listProjects().map((project) => ({ id: project.id, name: project.name, updatedAt: project.updatedAt }))
}

export function createNamedProject(name?: string): { id: string; name: string } {
  const record = createProject(name ? { name } : {})
  return { id: record.id, name: record.name }
}

/**
 * 列出 catalog 里 enabled 的模型（供外部 agent 选型）——**带真话**：每条附 keyStatus（ok/missing/locked）
 * + 一句人话状态 + 参考承载力（能不能带图/视频/音频、能否多图、哪些模式带）。派生逻辑收口在
 * catalog/modelCatalogListing（复用 secrets 三态健康度 + referenceReachability 承载力判据，P1 不另写一份）。
 * 不静默丢没 key/发不出的模型——照列并标状态，让 agent 能对用户说清"kie 没配 key"而非瞎猜可用。
 */
export function listAvailableModels(): ModelListingEntry[] {
  return deriveModelListing(readCatalog())
}

// ── 画布级（经 ProjectGateway：A 模式转发渲染层 / B 模式直写盘，统一逻辑）──────

export async function readProjectCanvas(gateway: ProjectGateway): Promise<ReturnType<typeof readCanvas>> {
  return readCanvas(await gateway.readDoc())
}

export async function addProjectNodes(gateway: ProjectGateway, specs: NodeSpec[], projectId = ''): Promise<{ ids: string[]; cancelled?: boolean }> {
  // 方案门（Phase B）：≥2 节点 = 一套「方案」→ 落画布前弹应用内确认卡（app 开着时；headless 直放行）。
  // 让用户看到外部 agent 要在自己画布上建什么、可否决。单节点不弹（免费可撤、不加摩擦）。拒绝→不落、回 cancelled。
  if (specs.length >= 2) {
    const approved = await gateway.confirmPlan({
      projectId,
      nodeCount: specs.length,
      titles: specs.map((spec) => (typeof spec.title === 'string' ? spec.title.trim() : '')).filter(Boolean).slice(0, 8),
    })
    if (!approved) return { ids: [], cancelled: true }
  }
  const { snapshot, ids } = addNodes(await gateway.readDoc(), specs)
  await gateway.apply(snapshot)
  return { ids }
}

export async function connectProjectNodes(gateway: ProjectGateway, connections: ConnectionSpec[]): Promise<{
  edgeIds: string[]
  skipped: Array<{ connection: ConnectionSpec; reason: string }>
}> {
  const result = connectNodes(await gateway.readDoc(), connections)
  await gateway.apply(result.snapshot)
  return { edgeIds: result.edgeIds, skipped: result.skipped }
}

export async function setProjectNodePrompt(gateway: ProjectGateway, nodeId: string, prompt: string, title?: string): Promise<{ changed: boolean }> {
  const { snapshot, changed } = setNodePrompt(await gateway.readDoc(), nodeId, prompt, title)
  if (changed) await gateway.apply(snapshot)
  return { changed }
}

export async function freezeProjectNodes(
  gateway: ProjectGateway,
  nodeIds: string[],
  by: 'user' | 'mcp' = 'mcp',
): Promise<{
  frozen: string[]
  skipped: Array<{ nodeId: string; reason: string }>
}> {
  const result = freezeNodes(await gateway.readDoc(), nodeIds, Date.now(), by)
  if (result.frozen.length) await gateway.apply(result.snapshot)
  return { frozen: result.frozen, skipped: result.skipped }
}

export async function deleteProjectNodes(gateway: ProjectGateway, nodeIds: string[]): Promise<{ deleted: string[] }> {
  const { snapshot, deleted } = deleteNodes(await gateway.readDoc(), nodeIds)
  if (deleted.length) await gateway.apply(snapshot)
  return { deleted }
}

export async function groupProjectNodes(gateway: ProjectGateway, nodeIds: string[], name: string): Promise<{
  group: { id: string; name: string; categoryId: string; nodeIds: string[] } | null
  created: boolean
  skipped: Array<{ nodeId: string; reason: string }>
}> {
  const result = groupNodes(await gateway.readDoc(), nodeIds, name)
  if (result.created) await gateway.apply(result.snapshot)
  return {
    group: result.group ? {
      id: result.group.id,
      name: result.group.name,
      categoryId: result.group.categoryId,
      nodeIds: [...result.group.nodeIds],
    } : null,
    created: result.created,
    skipped: result.skipped,
  }
}

// ── 生成（复用主进程 runtime.runTask；B 模式落结果回节点）─────────────────

export type GenerateInput = {
  projectId: string
  /** 既有节点 id；不给则用 prompt 新建一个节点再生成。 */
  nodeId?: string
  /** 新建节点时的提示词；既有节点不给则用节点现有 prompt。 */
  prompt?: string
  intent?: GenerateIntent
  /** 显式 ProfileKind（如 text_to_image）；不给则由 intent 推。 */
  kind?: string
  vendor: string
  modelKey: string
  /** 透传进 extras 的生成参数（width/height/seed/duration…），主进程 archetypeInput 映射。 */
  params?: Record<string, unknown>
  /** 参考图（公网 URL 或 nomi-local://），落进 extras.referenceImages。 */
  references?: string[]
  title?: string
  /**
   * 分镜给的**静态首帧画面描述**（PlanShot.ffDesc，W2 §4）。video 镜走两跳时第 1 跳用它出首帧图；
   * 不给则退回镜头 prompt。纯增量字段——不给 = 行为与今天一致。
   */
  firstFrameDesc?: string
  /**
   * 分镜给的**静态尾帧画面描述**（PlanShot.lfDesc，W2 §4）。有它 + 模型 body 真有尾帧槽时，
   * 两跳会多出一张尾帧图，把运动的落点也夹住（只给首帧时中后段全靠模型自己发挥）。
   * 纯增量——不给 = 行为与今天一致，多花的那张图只在真用得上时才花。
   */
  lastFrameDesc?: string
  /**
   * 由 **MCP 协议层置位**（mcpProtocol.ts，非模型入参）：这次确认还会换来「本会话该项目同一模型服务后续生成免问」，
   * 故应用内确认卡要多写一句授权范围。只影响卡上文案，不放宽任何授权——令牌照旧逐次铸、逐次核验。
   */
  grantsSessionTrust?: boolean
  /** 只续查节点已保存的 provider taskId；找不到就报错，绝不确认付费或新提交。 */
  resumeOnly?: boolean
  /**
   * 审片环 deps 工厂（可选，传输层注入）。**不传 = 行为逐字节不变**（不判分、不重试，返回同今天）。
   * 传了 → 生成成功后跑一次审片环（判分→定向重试 K≤2→红标），outcome 挂到返回的 `verify`。
   * 不是模型能填的入参——由 dispatcher 从 DispatchContext 注入（同 makeGateway 的注入模式）。
   */
  makeVerifyDeps?: MakeVerifyDeps
  /**
   * 审片总时长硬界（毫秒，缺省 orchestrate 内 ~60s）。判分（含底层 HTTP 重试 + 定向重试）超界/失败 →
   * skipped(reason)、生成结果照常返回（L3 韧性铁律：判分绝不把 tools/call 拖到客户端超时）。主要给测试注入。
   */
  verifyDeadlineMs?: number
}

/**
 * 触发一次生成。构造高层 TaskRequest → runTask（主进程组装请求体 + 发 vendor + 落资产）。
 * 异步 vendor（modelscope 图 / 视频）首调返 queued → 用 fetchTaskResultFn **在本进程内**轮询到终态
 * （taskCache 是进程内的，host 退出即丢，故不能跨调用轮询，必须本调用内等完）。再把结果写回节点。
 * runTask/fetchTaskResult 注入式（测试不真打 vendor）。
 */
export async function generateOnProject(
  input: GenerateInput,
  gateway: ProjectGateway,
  runTaskFn: RunTaskFn,
  fetchTaskResultFn?: FetchTaskResultFn,
): Promise<{
  nodeId: string
  status: string
  assets: TaskResultLike['assets']
  /** 审片环结果（仅当注入了 makeVerifyDeps 且判分真跑时出现；默认路径不含此字段=行为不变）。 */
  verify?: ShotVerifyOutcome
}> {
  let snapshot = await gateway.readDoc()

  // 解析/新建目标节点
  let nodeId = input.nodeId || ''
  const intent = input.intent || 'image'
  if (!nodeId) {
    const nodeKind = intent === 'video' ? 'video' : intent === 'audio' ? 'audio' : intent === 'text' ? 'text' : 'image'
    const created = addNodes(snapshot, [{ kind: nodeKind, prompt: input.prompt, title: input.title, references: input.references }])
    snapshot = created.snapshot
    nodeId = created.ids[0]
  } else if (typeof input.prompt === 'string' && input.prompt.trim()) {
    const updated = setNodePrompt(snapshot, nodeId, input.prompt, input.title)
    snapshot = updated.snapshot
  }

  const node = snapshot.nodes.find((item) => item.id === nodeId)
  if (!node) throw new Error(`节点不存在: ${nodeId}`)
  const prompt = typeof node.prompt === 'string' ? node.prompt.trim() : ''
  if (!prompt && intent !== 'audio') throw new Error('prompt is required')

  const references = input.references && input.references.length
    ? input.references
    : (Array.isArray(node.references) && node.references.length ? node.references : referencesFromEdges(snapshot, nodeId))
  const frames = frameUrlsFromEdges(snapshot, nodeId)
  const paramsRecord = input.params && typeof input.params === 'object' ? input.params : {}
  const paramFirst = typeof paramsRecord.first_frame === 'string' ? paramsRecord.first_frame.trim()
    : typeof paramsRecord.firstFrameUrl === 'string' ? paramsRecord.firstFrameUrl.trim() : ''
  const paramLast = typeof paramsRecord.last_frame === 'string' ? paramsRecord.last_frame.trim()
    : typeof paramsRecord.lastFrameUrl === 'string' ? paramsRecord.lastFrameUrl.trim() : ''
  const hasFl2vaFrames = Boolean((paramFirst && paramLast) || (frames.first && frames.last))
  // kind 选择（W1d，见 docs/plan/2026-08-20-w1d-reference-mode-alignment.md）：显式 input.kind 最高优先；
  // 带参考时**按目录 derive**该模型真实可带参考的模式（与 list_models 的 referenceModes 同一份源，P1），不再硬编码
  // image→image_edit / video→image_to_video（那对「参考模式≠默认名」的模型会选错 kind、被护栏误拒）。derive 不出
  // （无任何参考模式，或 intent 非 image/video）→ 回退 defaultKindForIntent 走护栏诚实拒绝（语义不放松）。
  const derivedRefKind =
    references.length > 0 && (intent === 'image' || intent === 'video')
      ? referenceModeForIntent(readCatalog(), input.vendor, input.modelKey, intent)
      : null
  const kind = input.kind
    || (intent === 'video' && hasFl2vaFrames ? 'image_to_video' : '')
    || derivedRefKind
    || defaultKindForIntent(intent, references.length > 0)

  const isAutodlArtH3Early = input.vendor === AUTODL_ART_VENDOR_SEED.key && input.modelKey === AUTODL_ART_H3_MODEL_SEED.modelKey
  if (isAutodlArtH3Early) {
    const guardParams: Record<string, unknown> = { ...(input.params || {}) }
    if (paramFirst || frames.first) {
      const first = paramFirst || frames.first
      guardParams.first_frame = first
      guardParams.firstFrameUrl = first
    }
    if (paramLast || frames.last) {
      const last = paramLast || frames.last
      guardParams.last_frame = last
      guardParams.lastFrameUrl = last
    }
    if (references.length) {
      guardParams.reference_image_urls = references
      guardParams.referenceImages = references
    }
    const rejected = autodlArtH3RejectReason(guardParams, kind)
    if (rejected) throw new Error(rejected)
    const mapped = normalizeAutodlArtH3Resolution(
      guardParams.resolution,
      guardParams.aspect_ratio || paramsRecord.aspectRatio,
    )
    if (mapped === null) throw new Error(AUTODL_ART_H3_RESOLUTION_REFUSE)
  }

  // 已经拿到 provider taskId 的节点只续查，绝不重新走确认/提交。覆盖 running/recoverable，
  // 也覆盖旧版把查询断线错误落成 error 的项目（taskIdentityFromNode 负责一次性迁移）。
  const persistedTask = (() => {
    const identity = nodeHasRecoverableTask(node, input.vendor)
      ? taskIdentityFromNode(node, input.vendor, kind)
      : null
    if (identity && isAutodlArtH3Early && isAutodlArtLocalFallbackTaskId(identity.taskId)) return null
    return identity
  })()
  if (persistedTask && fetchTaskResultFn) {
    await gateway.apply(setNodeTaskInSnapshot(await gateway.readDoc(), nodeId, persistedTask, 'running'))
    try {
      let resumed = (await fetchTaskResultFn({
        taskId: persistedTask.taskId,
        vendor: input.vendor,
        taskKind: persistedTask.taskKind,
        prompt,
        modelKey: input.modelKey,
        projectId: input.projectId,
      })).result
      const envPoll = Number(process.env.NOMI_POLL_TIMEOUT_MS)
      const timeoutMs = Number.isFinite(envPoll) && envPoll > 0 ? envPoll : 300000
      const startedAt = Date.now()
      while (resumed.status && !isTerminalTaskStatus(resumed.status)) {
        if (Date.now() - startedAt > timeoutMs) {
          throw new Error(desktopT('tasks.pollTimedOut', {
            seconds: Math.round((Date.now() - startedAt) / 1000),
            status: resumed.status || 'unknown',
          }))
        }
        await delayTaskPoll(3000)
        resumed = (await fetchTaskResultFn({
          taskId: persistedTask.taskId,
          vendor: input.vendor,
          taskKind: persistedTask.taskKind,
          prompt,
          modelKey: input.modelKey,
          projectId: input.projectId,
        })).result
      }
      await gateway.apply(writeResultToSnapshot(await gateway.readDoc(), nodeId, resumed, intent))
      return { nodeId, status: resumed.status || 'unknown', assets: resumed.assets || [] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await gateway.apply(setNodeTaskInSnapshot(await gateway.readDoc(), nodeId, persistedTask, 'recoverable', message))
      throw error
    }
  }
  if (input.resumeOnly) {
    throw new Error(`节点 ${nodeId} 没有可续查的供应商任务；为避免重复扣费，本次没有提交新任务。`)
  }

  if ((intent === 'image' || intent === 'video') && !isVisualAnchorKind(typeof node.kind === 'string' ? node.kind : '')) {
    const unfrozenBeforeSpend = unfrozenAnchorsForShot(referenceSourceNodes(snapshot, nodeId))
    if (unfrozenBeforeSpend.length) {
      throw new Error(
        `这一镜引用的 ${unfrozenBeforeSpend.length} 张卡还没定妆：${unfrozenBeforeSpend.map((n) => n.title || n.id).join('、')}。`
        + '先 nomi_freeze_nodes 再生成，避免跨镜换脸。',
      )
    }
  }

  // 先把节点以「排队中」态写出去——A 模式：节点立即出现在画布（所见即所得）；B 模式：落盘占位。
  snapshot = setNodeStatusInSnapshot(snapshot, nodeId, 'queued')
  await gateway.apply(snapshot)

  // 付费确认：A 模式弹实时卡，真人点确认才铸令牌；B 模式只认 env 逃生口。
  // 不在此硬拦——enforcement 仍在 runTask 内的 assertAndConsumeSpendGrant（红队不变量：主进程硬闸）；
  // 未确认 = 不带 grantId，runTask 会 fail-fast 抛「未确认」并秒回，不死等、不烧额度。
  const projectName = readProject(input.projectId)?.name
  const grantId = await gateway.confirmSpend({
    projectId: input.projectId,
    ...(projectName ? { projectName } : {}),
    nodeId,
    intent,
    vendor: input.vendor,
    modelKey: input.modelKey,
    prompt,
    approvalScope: createSpendTrustScope(input.projectId, input.vendor, input.modelKey),
    // 协议层置位（不是模型能填的入参）：这张卡点下去还会换来一段免问期 → 卡上要写明授权范围。
    ...(input.grantsSessionTrust ? { grantsSessionTrust: true } : {}),
  })

  // 进入生成中态（A 模式：节点显示「生成中」）。
  snapshot = setNodeStatusInSnapshot(snapshot, nodeId, 'running')
  await gateway.apply(snapshot)

  // I2V 两跳（W2 §3）：video 镜带锚参考、且该模型 body 真读得到首帧键 → 先出一张首帧图（I2I 锚身份），
  // 再把它当 first_frame 喂 I2V。「给它照片让它动起来」比「凭文字想象一个人」稳一个数量级（业界共识）。
  // 判据/编排住 i2vTwoHop.ts（纯，可裸测）；这里只做接线。任一步不成 → applied:false 降级为今天的一跳，
  // **绝不让首帧那跳的失败拖垮整个生成**。首帧走独立 grant（方案解 A：镜头 grant 的 3 次留给视频+审片重试，
  // spendGrant.ts 一字不动）。
  /**
   * 出一张「静态帧」图（首帧或尾帧），供两跳当锚。两个槽共用这一份实现：同一供应商/模型、同一批锚参考、
   * 各自铸**独立 grant**（方案解 A：镜头 grant 的 3 次配额留给视频本身 + 审片重试，spendGrant.ts 一字不动）。
   */
  // 谁来画首帧图：**必须是图片模型**，不能是这一镜的视频模型。
  // 曾经这里直接用 input.modelKey（= Seedance，目录里是 video 类）去发 image_edit，
  // findExecutableModel 按 kind 过滤当然找不到 → 抛错 → runFirstHop 吞掉 → 静默降级一跳。
  // 这就是两跳修好键名判据后**仍然**不触发的真根因（L3-F1b 复验抓出）。
  const painter = pickFirstFramePainter(
    deriveModelListing(readCatalog()).map((m) => ({
      vendorKey: m.vendor, modelKey: m.modelKey, kind: m.kind,
      keyStatus: m.keyStatus, references: m.references,
    })),
    input.vendor,
  )
  const renderStaticFrame = async (
    slot: 'ff' | 'lf',
    { prompt: framePrompt, references: frameRefs }: { prompt: string; references: string[] },
  ) => {
    if (!painter) throw new Error('本机没有可用于出首帧图的图片模型（需 kind=image 且吃得下图片参考）')
    const grant = await gateway.confirmSpend({
      projectId: input.projectId, ...(projectName ? { projectName } : {}), nodeId,
      intent: 'image', vendor: painter.vendorKey, modelKey: painter.modelKey, prompt: framePrompt,
    })
    const frameKind = referenceModeForIntent(readCatalog(), painter.vendorKey, painter.modelKey, 'image') || 'image_edit'
    const out = await runTaskFn({
      vendor: painter.vendorKey,
      request: {
        kind: frameKind,
        prompt: framePrompt,
        extras: {
          // 不继承 input.params：那些是**视频模型**的参数（duration/generate_audio…），
          // 塞进图片请求纯属噪音。只留画幅——首帧图必须和视频同画幅，否则第 2 跳会裁切或加边。
          ...(input.params && typeof input.params === 'object'
            ? Object.fromEntries(Object.entries(input.params).filter(([k]) => /aspect|ratio|size/i.test(k)))
            : {}),
          modelKey: painter.modelKey, modelAlias: painter.modelKey, projectId: input.projectId,
          nodeId, nodeKind: 'image', referenceImages: frameRefs,
          ...(grant ? { grantId: grant } : {}),
          idempotencyKey: `mcp-${slot}-${crypto.randomUUID()}`,
        },
      },
    })
    // **异步 vendor 首调只返 taskId，必须轮询到终态**——这是两跳一直失败的最后一环：
    // seedream 这类图片模型走「提交 → 轮询」，首次返回没有 assets，这里直接读 assets[0] 永远是空，
    // 于是 runFirstHop 判「首帧未产出可用图」→ 每次都降级。主路径（下面那段）一直有轮询，
    // 这条支路漏了（单测的 runTaskFn 桩是同步返图的，桩不会 queued，所以测不出来）。
    let frame = out
    if (fetchTaskResultFn && frame.status && !isTerminalTaskStatus(frame.status)) {
      const startedAt = Date.now()
      while (frame.status && !isTerminalTaskStatus(frame.status)) {
        if (Date.now() - startedAt > 240000) break // 首帧是增益，到点就放弃走一跳，不拖垮整镜
        await delayTaskPoll(1500)
        const polled = await fetchTaskResultFn({
          taskId: frame.id || '', vendor: painter.vendorKey, taskKind: frameKind,
          prompt: framePrompt, modelKey: painter.modelKey,
          projectId: input.projectId,
        })
        frame = polled.result
      }
    }
    const url = (frame.assets || [])[0]?.url
    return url ? { url } : null
  }

  const videoBodyKeys = videoBodyKeysForModel(readCatalog(), input.vendor, input.modelKey)
  // 「这个模型的 video 模式吃不吃图片参考」——问目录那张经实战打磨的参考键族表（list_models 同源），
  // 不再自己写正则猜键名（那正是两跳在 Seedance 上从没触发过的根因：image_urls 匹配不上 image_url$）。
  const videoAcceptsImageReference = videoBodyKeys.some(
    (key) => classifyReferenceKeyDetailed(key)?.family === 'image',
  )
  // 尾帧只在「模型真有尾帧槽 + 分镜真给了 lfDesc」时才出——两者缺一就不多烧这张图。
  const wantsLastFrame = shouldRenderLastFrame({
    twoHopApplied: true, // 这里只问「模型/分镜条件够不够」；真没走成两跳时 runFirstHop 会自己短路
    ...(input.lastFrameDesc ? { lastFrameDesc: input.lastFrameDesc } : {}),
    videoBodyKeys,
  })
  const twoHop = shouldUseTwoHop({ intent, references, videoAcceptsImageReference })
    ? await runFirstHop(
        {
          prompt,
          ...(input.firstFrameDesc ? { firstFrameDesc: input.firstFrameDesc } : {}),
          ...(wantsLastFrame && input.lastFrameDesc ? { lastFrameDesc: input.lastFrameDesc } : {}),
          references,
        },
        {
          renderFirstFrame: (args) => renderStaticFrame('ff', args),
          // 尾帧与首帧同一条出图路径（同锚参考、同独立 grant），只有幂等键前缀不同——
          // 不写第二份实现（P1）。模型没尾帧槽 / 分镜没给 lfDesc → 这里根本不传，整段路径不存在。
          ...(wantsLastFrame ? { renderLastFrame: (args) => renderStaticFrame('lf', args) } : {}),
        },
      )
    : null

  // 没走两跳时把分镜的首/尾帧描述折进提示词——否则那些场景描述一个字都用不上（L3-F1 实测：
  // 空镜的 ffDesc 全丢，模型只收到运动那行，出来一座维多利亚书房座钟而不是便利店挂钟）。
  // 走成两跳时原样不动：静态信息已由真图承载，再用文字复述会和图打架。
  const effectivePrompt = composeShotPrompt({
    prompt,
    ...(input.firstFrameDesc ? { firstFrameDesc: input.firstFrameDesc } : {}),
    ...(input.lastFrameDesc ? { lastFrameDesc: input.lastFrameDesc } : {}),
    twoHopApplied: Boolean(twoHop?.applied),
  })

  const isAutodlArtH3 = input.vendor === AUTODL_ART_VENDOR_SEED.key && input.modelKey === AUTODL_ART_H3_MODEL_SEED.modelKey
  let extrasParams: Record<string, unknown> = { ...(input.params || {}) }
  if (!paramFirst && frames.first) {
    extrasParams.first_frame = frames.first
    extrasParams.firstFrameUrl = frames.first
  }
  if (!paramLast && frames.last) {
    extrasParams.last_frame = frames.last
    extrasParams.lastFrameUrl = frames.last
  }
  if (isAutodlArtH3) {
    const rejected = autodlArtH3RejectReason(extrasParams, kind)
    if (rejected) throw new Error(rejected)
    extrasParams = prepareAutodlArtH3Params(extrasParams)
  }

  const request = {
    kind,
    prompt: effectivePrompt,
    extras: {
      ...extrasParams,
      modelKey: input.modelKey,
      modelAlias: input.modelKey,
      projectId: input.projectId,
      nodeId,
      nodeKind: node.kind,
      // 两跳成了 → **参考通道换成那张首帧静帧**，不再发原始锚卡。
      //
      // 为什么这才是两跳的意义：锚卡是「中性灰背景的正面证件照」，把它当 i2v 的驱动图，等于让视频
      // 从一张证件照开始动；而首帧静帧是「已经长成这一镜该有的样子」的画面（含 ffDesc 的景别/光线/
      // 场景）**且身份已由锚卡锁定**——它同时携带身份与构图，比锚卡强得多。
      // 只发静帧不再补发锚卡：i2v 语义里第一张图就是驱动图，两张会打架。
      ...(twoHop?.applied && twoHop.firstFrameUrl
        ? { referenceImages: [twoHop.firstFrameUrl] }
        : references.length ? { referenceImages: references } : {}),
      // 有独立 first_frame 键的模型（如 Kling）再走这条专用位；Seedance 这类没有该键的，
      // 靠上面的参考通道送达——**两条路都留着，谁读得到谁生效**，不是并行实现（同一张图、同一个语义）。
      ...(twoHop?.applied && twoHop.firstFrameUrl ? { firstFrameUrl: twoHop.firstFrameUrl } : {}),
      // 尾帧图同理经 lastFrameUrl → last_frame_url（archetypeInput 里这条线早就通了，缺的一直是图本身）。
      ...(twoHop?.applied && twoHop.lastFrameUrl ? { lastFrameUrl: twoHop.lastFrameUrl } : {}),
      ...(grantId ? { grantId } : {}),
      // 提交幂等键：headless 路自生一个（本路无重试循环故无双发向量，纯纵深防御 + 未来若加重试已护住）。
      idempotencyKey: `mcp-${crypto.randomUUID()}`,
    },
  }

  let result: TaskResultLike
  let submittedTask: PersistedTaskIdentity | null = null
  try {
    result = await runTaskFn({ vendor: input.vendor, request })

    // 异步 vendor 首调返 queued/processing → 本进程内轮询到终态（视频给更长超时）。无 fetch 注入则不轮询。
    if (fetchTaskResultFn && result.status && !isTerminalTaskStatus(result.status)) {
      if (result.id) {
        submittedTask = { taskId: result.id, taskKind: kind }
        await gateway.apply(setNodeTaskInSnapshot(await gateway.readDoc(), nodeId, submittedTask, 'running'))
      }
      // 慢 vendor（如 APIMart H3 官方资源有限）可经 NOMI_POLL_TIMEOUT_MS 覆盖本进程轮询上限；
      // 视频默认 15 分钟与供应商建议一致，避免 5 分钟时任务仍在上游排队却被本地判失败。
      const timeoutMs = resolveCapabilityPollTimeoutMs(kind)
      // 轮询间隔与渲染层同策：视频 3s、其余 1.5s（厂商文档要求查询间隔 ≥3-5s，见
      // docs/plan/2026-07-31-seedance-api-contract-reconciliation.md §三）。跨进程边界拿不到
      // 渲染层的 resolvePollIntervalMs，故此处是**配对常量，改一处必改另一处**（同 vendorErrorIpc
      // 的 MARKER 约定）。本循环一次只跑一个任务，不存在批量同相位问题，故不叠抖动/退避。
      const pollIntervalMs = kind === 'text_to_video' || kind === 'image_to_video' ? 3000 : 1500
      const startedAt = Date.now()
      while (result.status && !isTerminalTaskStatus(result.status)) {
        if (Date.now() - startedAt > timeoutMs) {
          // 到点必须落**终态**：旧版直接 break，result 保持 queued/running 且不带 error —— 调用方
          // （MCP/agent/CLI）拿到一个永远非终态的结果，等同「转圈但没人告诉你出了什么事」。
          // 超时≠上游一定失败，故文案明说任务可能仍在供应商侧运行。
          throw new Error(desktopT('tasks.pollTimedOut', {
            seconds: Math.round((Date.now() - startedAt) / 1000),
            status: result.status || 'unknown',
          }))
        }
        await delayTaskPoll(pollIntervalMs)
        const polled = await fetchTaskResultFn({
          taskId: result.id || '',
          vendor: input.vendor,
          taskKind: kind,
          prompt,
          modelKey: input.modelKey,
          projectId: input.projectId,
        })
        result = polled.result
      }
    }
  } catch (error) {
    // 已拿到 taskId 后的查询断线/超时 ≠ 生成失败：保留可续查回执，绝不让下一次调用重新下单。
    // 未拿到 taskId 才沿用 error（可能是确认拒绝、提交前校验或提交明确失败）。
    const message = error instanceof Error ? error.message : String(error)
    try {
      await gateway.apply(submittedTask
        ? setNodeTaskInSnapshot(await gateway.readDoc(), nodeId, submittedTask, 'recoverable', message)
        : setNodeStatusInSnapshot(await gateway.readDoc(), nodeId, 'error', message))
    } catch {
      /* 写 error 态失败不掩盖原始错误 */
    }
    throw error
  }

  // 落结果回节点。重读快照（A 模式用户可能挪过卡）再写目标节点。图/视频/音频走首资产；文本在 raw。
  const persisted = writeResultToSnapshot(await gateway.readDoc(), nodeId, result, intent)
  await gateway.apply(persisted)

  const primary = (result.assets || [])[0]
  const text = intent === 'text' ? extractTextFromRaw(result.raw) : (typeof primary?.text === 'string' ? primary.text : '')

  // 审片环 hook（W1）：注入了 makeVerifyDeps 且生成出了可视产物 → 跑一次判分→定向重试→红标，outcome 挂返回。
  // **默认不传 = 不进这个分支 = 返回逐字节同今天**（T5 回归测试锁死）。审片是增益：任一步失败绝不阻断生成完成。
  let verify: ShotVerifyOutcome | undefined
  const canVerify =
    typeof input.makeVerifyDeps === 'function'
    && result.status === 'succeeded'
    && (intent === 'image' || intent === 'video')
    && typeof primary?.url === 'string' && primary.url.length > 0
  if (canVerify) {
    try {
      const deps = input.makeVerifyDeps!({
        projectId: input.projectId,
        grantId: grantId || '',
        nodeId,
        vendor: input.vendor,
        modelKey: input.modelKey,
        generationKind: kind,
        nodeKind: typeof node.kind === 'string' ? node.kind : (intent === 'video' ? 'video' : 'image'),
        basePrompt: prompt,
        params: input.params || {},
        references,
      })
      const outcome = await verifyAndMaybeRetry(
        {
          shot: {
            shotNodeId: nodeId,
            shotTitle: typeof node.title === 'string' && node.title ? node.title : (typeof input.title === 'string' ? input.title : `镜头 ${nodeId}`),
            // 判分要对着**我们真正发给模型的那份提示词**判，不是原始那行运动描述。
            // L3-F1 实测的第二层坑：ffDesc 被丢掉时，判分器拿到的是同一份被削过的提示词，
            // 于是「便利店挂钟」出成「书房座钟」它照样给构图 5 分——**判分环对上游丢失的信息是盲的**。
            // 对齐成同一份后，场景漂移才变成判分器抓得到的东西。
            shotPrompt: effectivePrompt,
            anchorDescriptions: anchorDescriptionsForNode(snapshot, nodeId),
            // 连贯轴的参照物：同分类里紧邻的上一镜（按 shotIndex derive）。以前从没传过，于是审片环
            // 对外说三轴、实际只跑了两轴——而「接不接得上」正是短剧最容易崩的那一轴（L3-F1 实测抓出）。
            // 判不出上一镜时返回 undefined → 判分器按「首镜不评 continuity」处理，不拿错参照物硬比。
            ...(() => {
              const prev = previousShotPromptFor(snapshot.nodes, nodeId)
              return prev ? { previousShotPrompt: prev } : {}
            })(),
            frameSourceUrl: primary!.url as string,
            isVideo: intent === 'video',
          },
          ...(typeof input.verifyDeadlineMs === 'number' ? { deadlineMs: input.verifyDeadlineMs } : {}),
        },
        deps,
      )
      // 真判分（evaluated）→ 挂交付；判分**超时/连续失败**的诚实跳过（skipped 带 reason）也挂——
      // 让交付诚实标「审片：跳过（原因）」（L3 韧性修复，D4 不藏）。纯静默跳过（无 reason）不挂，转述与今天一致。
      if (outcome.evaluated || (outcome.skipped && outcome.reason)) verify = outcome
    } catch {
      /* 审片失败绝不掩盖「生成已完成」——静默降级为无审片信息（同渲染层 runner 的增益语义）。 */
    }
  }

  const advisories: string[] = []
  // 两跳降级的**理由必须说出来**（D4 缺口明着标）。它一直被算出来却从没暴露过——
  // 于是「两跳没跑」这件事在外面表现为**完全静默**，L3-F1b 复验时我只能靠数生成图的张数反推，
  // 还查了半小时才定位。降级本身不是错（它是韧性设计），沉默才是。
  if (twoHop && !twoHop.applied && twoHop.reason) {
    advisories.push(`未走「先出首帧图再生成视频」的两跳：${twoHop.reason}`)
  }

  return {
    nodeId,
    status: result.status || 'unknown',
    assets: result.assets || [],
    ...(text ? { text } : {}),
    ...(verify ? { verify } : {}),
    ...(advisories.length ? { advisories } : {}),
  }
}

/** 该镜锚描述：指向本节点的参考类入边的**源节点 prompt**（角色/场景卡的设定文本，身份轴对照基准）。 */
function anchorDescriptionsForNode(snapshot: CanvasSnapshot, nodeId: string): string[] {
  const out: string[] = []
  for (const source of referenceSourceNodes(snapshot, nodeId)) {
    const desc = source && typeof source.prompt === 'string' ? source.prompt.trim() : ''
    if (desc && !out.includes(desc)) out.push(desc)
  }
  return out
}
