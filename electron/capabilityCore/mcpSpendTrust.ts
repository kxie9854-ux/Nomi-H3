// 能力核 · MCP 付费生成的会话级信任 + 文案（见 plan 2026-08-19-session-scoped-spend-trust.md）。
//
// 治用户原话「那这样反复去软件确认 不是太麻烦了」——重点在**反复**。某项目首次付费生成照旧问真人，
// 批准后本会话该项目、同一模型服务的后续生成不再逐次问。信任**纯内存**、挂协议实例闭包，
// 连接断随进程亡、不持久化；按 projectId + vendor + modelKey 隔离，避免静帧授权顺带放行昂贵视频。
//
// 与 mcpPlanTrust 刻意**不合并**：方案门免费可撤、无计数无阈值；付费门要计数 + 再问 + 授权范围披露。
// 共同点只有一个 Set<projectId>（8 行），为它造抽象层会做出带一半没人用的参数的东西（P1 的反面）。
//
// 与渲染层的 lightSuppressed 也不是一回事：那是「全局 + 渲染层会话 + 仅用户直发轻确认」，
// 且注释明写 agent 不可 light 抑制。本模块是「按项目 + MCP 会话 + agent 驱动」，三个轴都不同。

/**
 * 一次批准最多免问几次，之后再确认一次。
 *
 * 为什么要这个上限：用户选的是「会话级信任」而非「额度包」，所以**不引入用户要理解的配额概念**；
 * 但「一次批准换无限花钱」意味着跑飞的 agent 循环能把额度烧干。这是安全上限、不是用户要管的配额——
 * 20 次够覆盖一次正常创作会话（一集分镜十几个镜头），又把单次批准的最坏损失钉死在 20 次生成内。
 */
export const SPEND_TRUST_REASK_AFTER = 20

export function createSpendTrustScope(projectId: string, vendor: unknown, modelKey: unknown): string {
  if (!projectId) return ''
  return [projectId, String(vendor || 'default-vendor'), String(modelKey || 'default-model')].join('\u0000')
}

/** 一条 MCP 会话内的付费信任集（项目 + 模型服务粒度）。协议实例各持一个，互不共享。 */
export function createSpendTrustStore() {
  // scopeKey → 自上次真人批准以来，已「免问放行」的次数。
  const passesSinceApproval = new Map<string, number>()
  return {
    isTrusted(scopeKey: string): boolean {
      if (!scopeKey) return false
      const used = passesSinceApproval.get(scopeKey)
      return used !== undefined && used < SPEND_TRUST_REASK_AFTER
    },
    trust(scopeKey: string): void {
      if (scopeKey) passesSinceApproval.set(scopeKey, 0)
    },
    countPass(scopeKey: string): void {
      if (!scopeKey) return
      const used = passesSinceApproval.get(scopeKey)
      if (used !== undefined) passesSinceApproval.set(scopeKey, used + 1)
    },
    hasApprovedBefore(scopeKey: string): boolean {
      return scopeKey ? passesSinceApproval.has(scopeKey) : false
    },
  }
}

export type SpendTrustStore = ReturnType<typeof createSpendTrustStore>

/** 单节点自动重试上限（W1 审片环）——与 shotVerifyOrchestrate 的封顶、spendGrant 的 maxAttemptsPerNode-1 对齐。 */
export const SPEND_AUTO_RETRY_MAX = 2

/**
 * 付费确认的聊天弹框文案。**必须说清它在授权什么**：
 * 用户以为批的是「这一张」，实际批的是「本会话这个项目往后都不问」——不写明就是骗同意（D4「缺口明着标」）。
 * reask=true 是用满免问额度后的那一问，要讲清为什么又来问，否则用户以为坏了。
 *
 * W1 诚实披露（裁定 D）：这次生成还包含**自动审片 + 最多 N 次定向重试**——重试落在同一颗 grant 的
 * 同节点预算内（不额外弹卡），但会真的多花「≤N 次重生」的额度。用户批的其实是「首发 + 最多 N 次重试」，
 * 不写明同样是骗同意。判分本身走文本 chat、不进这笔生成预算（成本远小于一次重生），故不在此逐项拆。
 */
export function spendConfirmElicit(costHint: string, reask: boolean): {
  message: string
  title: string
  description: string
} {
  const scope = `批准后，本会话在这个项目里使用同一模型服务的后续生成不再逐次询问（最多 ${SPEND_TRUST_REASK_AFTER} 次，切换模型服务或达到上限会再确认）。`
  const reviewNote = `本次生成含自动审片，画面不达标会定向重试最多 ${SPEND_AUTO_RETRY_MAX} 次（重试也算这次生成的额度）。`
  return {
    message: reask
      ? `本会话在这个项目已免问生成 ${SPEND_TRUST_REASK_AFTER} 次，按上限再确认一次。\n${costHint}\n${reviewNote}\n${scope}\n继续吗？`
      : `${costHint}\n${reviewNote}\n${scope}\n确认现在生成吗？`,
    title: '确认生成',
    description: `确认后将消耗模型额度生成；取消则不生成、不花费。${reviewNote}${scope}`,
  }
}

export function spendConfirmRequest(costHint: string, reask: boolean, scopeKey: string) {
  return {
    ...spendConfirmElicit(costHint, reask),
    meta: {
      nomiSpendApprovalScope: scopeKey,
      nomiSpendApprovalPasses: SPEND_TRUST_REASK_AFTER,
    },
  }
}
