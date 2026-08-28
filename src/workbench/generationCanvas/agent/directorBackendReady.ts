export const DIRECTOR_STILLS_MODEL_KEY = 'codex-imagegen'
export const DIRECTOR_VIDEO_VENDOR = 'autodl-art'
export const DIRECTOR_VIDEO_MODEL_KEY = 'autodl-art-h3'

export type DirectorBackendVendor = {
  key: string
  enabled: boolean
  hasApiKey?: boolean
  authType?: string | null
}

export type DirectorBackendModel = {
  vendorKey: string
  modelKey: string
  enabled: boolean
}

export type DirectorBackendSnapshot = {
  stillsOk: boolean
  videoOk: boolean
}

function paidVendorReady(vendor: DirectorBackendVendor | undefined): boolean {
  if (!vendor || !vendor.enabled) return false
  if (vendor.authType === 'none') return true
  return Boolean(vendor.hasApiKey)
}

export function inspectDirectorBackends(input: {
  vendors: readonly DirectorBackendVendor[]
  models: readonly DirectorBackendModel[]
}): DirectorBackendSnapshot {
  const byKey = new Map(input.vendors.map((vendor) => [vendor.key, vendor]))
  const stills = input.models.find((model) => model.enabled && model.modelKey === DIRECTOR_STILLS_MODEL_KEY)
  const stillsVendor = stills ? byKey.get(stills.vendorKey) : undefined
  const video = input.models.find((model) => (
    model.enabled && model.vendorKey === DIRECTOR_VIDEO_VENDOR && model.modelKey === DIRECTOR_VIDEO_MODEL_KEY
  ))
  return {
    // 静帧是本机 Codex imagegen：目录里启用即可。没配 Nomi API Key 不挡（登录走 ChatGPT 套餐）。
    stillsOk: Boolean(stills && (!stillsVendor || stillsVendor.enabled)),
    videoOk: Boolean(video && paidVendorReady(byKey.get(DIRECTOR_VIDEO_VENDOR))),
  }
}

export function directorBackendsNeedSetup(snapshot: DirectorBackendSnapshot): boolean {
  return !snapshot.stillsOk || !snapshot.videoOk
}
