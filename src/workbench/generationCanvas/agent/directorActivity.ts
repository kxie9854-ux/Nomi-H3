export type DirectorActivityEvent = {
  type?: string
  tool?: string
  text?: string
}

/** One human line for the director chip. Null = hide (MCP traces, approvals, list/read). */
export function humanizeDirectorActivity(event: DirectorActivityEvent): string | null {
  const blob = [event.type, event.tool, event.text].filter(Boolean).join(' ').toLowerCase()
  if (!blob.trim()) return null
  if (/approval|permissions|filechange|execcommand|elicitation/.test(blob)) return null
  if (/save_director_skill|director\.saveSkill/.test(blob)) return '正在保存技能'
  if (/export_timeline|timeline\.export/.test(blob)) return '正在导出成片'
  if (/assemble_timeline|timeline\.assemble/.test(blob)) return '正在把成片排上时间轴'
  if (/nomi_generate/.test(blob) && /video/.test(blob)) return '正在出视频'
  if (/nomi_generate/.test(blob) && /image/.test(blob)) return '正在出静帧'
  if (/nomi_generate/.test(blob)) return '正在生成'
  if (/add_nodes|addnodes/.test(blob)) return '正在往画布落卡片'
  if (/connect_nodes|canvas\.connect/.test(blob)) return '正在连接镜头'
  if (/set_node_prompt|setprompt/.test(blob)) return '正在改提示词'
  if (/list_models|read_canvas|list_projects/.test(blob)) return null
  if (/\bmcp\b|mcp_tool/.test(blob)) return '正在画布上工作'
  return null
}
