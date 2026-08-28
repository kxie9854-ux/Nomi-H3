import { formatCanvasForAgent } from './canvasPromptContext'
import type { GenerationCanvasNode, GenerationCanvasEdge } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { DirectorSkillMode } from './directorSkillSelection'

export function buildDirectorCanvasContext(
  snapshot: { nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[]; selectedNodeIds?: readonly string[] },
  selectedNodes: readonly GenerationCanvasNode[],
  mode: DirectorSkillMode = 'film',
): string {
  const stills = selectedNodes.filter((node) => node.kind === 'image' && node.result?.url)
  const emptyLine = mode === 'author'
    ? '创建技能模式：不要落画布、不要 nomi_generate。只写 SKILL.md 并 nomi_save_director_skill。不要换项目。'
    : mode === 'none'
      ? '无技能模式：不要强制走成片脊柱。仍只用 autodl-art-h3 和 Codex 生图。不要换项目。'
      : '没有选中节点。新想法先确认画幅、时长、音频模式、一镜还是多镜，再用 :::choices 停下等用户点选，然后才落画布产物。默认先出静帧再 H3。成片用 nomi_assemble_timeline 排上时间轴，再 nomi_export_timeline 导出 MP4。不要换项目。'
  const iteration = selectedNodes.length === 0
    ? emptyLine
    : [
        `用户选中 ${selectedNodes.length} 个节点。说「改这镜 / 重做 / 换参考」时只操作这些 nodeId，不要另起无关镜头。`,
        stills.length >= 2
          ? '已有两张静帧：确认出视频时走 fl2va（first_frame + last_frame），不要再文生视频。'
          : stills.length === 1
            ? '只有一张静帧：确认出视频时走 ref2va references，不要只填 first_frame。'
            : '',
        ...selectedNodes.map((node) => {
          const result = node.result?.url ? ` result=${node.result.url}` : ''
          return `- 选中 ${node.id} kind=${node.kind} title=${node.title} status=${node.status || 'idle'}${result}`
        }),
      ].filter(Boolean).join('\n')
  return `${iteration}\n\n${formatCanvasForAgent(snapshot, selectedNodes)}`
}

export function readDirectorTurnContext(mode: DirectorSkillMode = 'film'): { canvasContext: string; selectedCount: number } {
  const state = useGenerationCanvasStore.getState()
  const selected = state.nodes.filter((node) => state.selectedNodeIds.includes(node.id))
  return {
    selectedCount: selected.length,
    canvasContext: buildDirectorCanvasContext(
      { nodes: state.nodes, edges: state.edges, selectedNodeIds: state.selectedNodeIds },
      selected,
      mode,
    ),
  }
}
