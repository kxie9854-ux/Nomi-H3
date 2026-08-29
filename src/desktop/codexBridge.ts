import type { DirectorHistory } from '../../electron/codexAppServer/directorHistory'
import type { DirectorSkillDto } from '../../electron/codexAppServer/directorSkills'

/** Optional bridge to the embedded Codex app-server. Paid generation still crosses Nomi's main-process gate. */
export type CodexDesktopBridge = {
  status: () => Promise<{ ready: boolean; account: { type?: string; email?: string | null; planType?: string | null } | null }>
  ensure: (cwd?: string) => Promise<{ account: { type?: string; email?: string | null; planType?: string | null } | null }>
  login: () => Promise<{ authUrl?: string }>
  send: (payload: { text: string; cwd?: string; projectId?: string; canvasContext?: string; skillIds?: string[]; mode?: 'none' | 'film' | 'author' }) => Promise<{ ok: boolean }>
  listSkills: () => Promise<DirectorSkillDto[]>
  importSkill: (payload: { markdown: string; fileName?: string }) => Promise<DirectorSkillDto>
  readHistory: (projectId: string) => Promise<DirectorHistory>
  interrupt: () => Promise<{ ok: boolean }>
  respondElicitation: (requestId: string, confirmed: boolean) => Promise<{ ok: boolean }>
  onEvent: (cb: (event: unknown) => void) => () => void
}
