import type { GenerationCanvasSnapshot } from '../model/generationCanvasTypes'

// 契约：创建路径的产物必须是「已迁移形态」（categoryId 出生即带上），过
// projectCategoryMigration 必须 no-op——否则新建项目会弹「已升级」迁移 toast，
// 甚至被迁移误删节点（审计 A4）。空画布天然满足（无节点可迁移）。
//
// 新建项目默认空画布（用户拍板 2026-06-15：删掉「剧本片段 + 关键画面」预设两卡）。
// 进画布即空 → 由 CanvasEmptyState 引导对 Codex 说话；手动建节点是次级入口。
export function createDefaultGenerationCanvasSnapshot(): GenerationCanvasSnapshot {
  return {
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    groups: [],
  }
}
