// 时间轴 assemble / export 的 MCP 转述。从 mcpToolResults 抽出，避免那份文件破 800 行。

type Locale = 'zh-CN' | 'en'
type Ctx = { locale: Locale }
const L = (ctx: Ctx, zh: string, en: string): string => (ctx.locale === 'en' ? en : zh)

export type TimelineToolOutcome = {
  text: string
  outcome: Record<string, unknown>
}

export function buildCanvasGroupOutcome(
  value: Record<string, unknown>,
  args: Record<string, unknown>,
  locale: Locale,
  projectId: string,
  openLine: string,
): TimelineToolOutcome {
  const ctx: Ctx = { locale }
  const group = value.group && typeof value.group === 'object' && !Array.isArray(value.group)
    ? value.group as Record<string, unknown>
    : {}
  const grouped = Array.isArray(group.nodeIds) ? group.nodeIds.length : 0
  const skipped = Array.isArray(value.skipped) ? value.skipped.length : 0
  const created = value.created === true
  const name = typeof group.name === 'string' ? group.name : (typeof args.name === 'string' ? args.name : '')
  const groupId = typeof group.id === 'string' ? group.id : ''
  const text = groupId
    ? [
        `✓ ${created ? L(ctx, '画布分组已创建', 'Canvas group created') : L(ctx, '已复用现有画布分组', 'Existing canvas group reused')} · ${name} · ${grouped} ${L(ctx, '个节点', 'nodes')}`,
        skipped ? L(ctx, `跳过 ${skipped} 个节点（不存在或分类不同）`, `Skipped ${skipped} node(s) (missing or in another category)`) : null,
      ].filter(Boolean).join('\n')
    : `✗ ${L(ctx, '没有创建分组：至少需要 2 个同分类的现有节点', 'No group created: at least 2 existing nodes from the same category are required')}`
  return {
    text: text + openLine,
    outcome: {
      kind: 'canvas_group', projectId, groupId: groupId || null, name, grouped, skipped, created,
      nextActions: groupId ? ['open_in_nomi'] : ['fix_node_selection'],
      openInNomi: projectId ? `nomi://project/${projectId}` : null,
    },
  }
}

export function buildTimelineAssembleOutcome(
  value: Record<string, unknown>,
  locale: Locale,
  projectId: string,
  openLine: string,
  openInNomi: string | null,
): TimelineToolOutcome {
  const ctx: Ctx = { locale }
  const arranged = typeof value.arranged === 'number' ? value.arranged : 0
  const total = typeof value.total === 'number' ? value.total : arranged
  const skipped = Array.isArray(value.skipped) ? value.skipped.length : 0
  const text = [
    `✓ ${L(ctx, '成片已排上时间轴', 'Film laid onto the timeline')} · ${arranged}/${total}`,
    skipped ? L(ctx, `跳过 ${skipped} 段（已在时间轴上或还不能排）`, `Skipped ${skipped} (already on the timeline or not ready)`) : null,
    L(ctx, '下一步：调用 nomi_export_timeline 导出 MP4。', 'Next: call nomi_export_timeline to export MP4.'),
  ].filter(Boolean).join('\n') + openLine
  return {
    text,
    outcome: {
      kind: 'timeline_assemble', projectId, arranged, total, skipped,
      nextActions: ['export_timeline'],
      openInNomi: openInNomi || (projectId ? `nomi://project/${projectId}` : null),
    },
  }
}

export function buildDirectorSaveSkillOutcome(
  value: Record<string, unknown>,
  locale: Locale,
  openLine: string,
): TimelineToolOutcome {
  const ctx: Ctx = { locale }
  const id = typeof value.id === 'string' ? value.id : ''
  const label = typeof value.label === 'string' ? value.label : id
  const text = [
    `✓ ${L(ctx, '导演技能已保存', 'Director skill saved')}${label ? ` · ${label}` : ''}`,
    id ? L(ctx, `芯片 id ${id}。切回「成片」后点选即可。`, `Chip id ${id}. Switch back to Film and click it.`) : null,
  ].filter(Boolean).join('\n') + openLine
  return {
    text,
    outcome: { kind: 'director_skill_save', id, label, nextActions: ['attach_skill'] },
  }
}

export function buildTimelineExportOutcome(
  value: Record<string, unknown>,
  locale: Locale,
  projectId: string,
  openLine: string,
  openInNomi: string | null,
): TimelineToolOutcome {
  const ctx: Ctx = { locale }
  const relativePath = typeof value.relativePath === 'string' ? value.relativePath : ''
  const filmNodeId = typeof value.filmNodeId === 'string' ? value.filmNodeId : ''
  const size = typeof value.size === 'number' ? value.size : 0
  const text = [
    `✓ ${L(ctx, '成片已导出 MP4', 'Film exported as MP4')}${relativePath ? ` · ${relativePath}` : ''}`,
    filmNodeId ? L(ctx, `画布成片卡 ${filmNodeId}`, `Canvas film card ${filmNodeId}`) : null,
    L(ctx, '不要让用户去预览区手点导出。成片卡已在画布上。', 'Do not send the user to the preview workspace to click export. The film card is on the canvas.'),
  ].filter(Boolean).join('\n') + openLine
  return {
    text,
    outcome: {
      kind: 'timeline_export', projectId, relativePath, filmNodeId, size,
      nextActions: ['open_in_nomi'],
      openInNomi: openInNomi || (projectId ? `nomi://project/${projectId}` : null),
    },
  }
}
