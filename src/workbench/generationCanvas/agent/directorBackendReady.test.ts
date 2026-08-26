import { describe, expect, it } from 'vitest'
import { directorBackendsNeedSetup, inspectDirectorBackends } from './directorBackendReady'

const autodl = { key: 'autodl-art', enabled: true, hasApiKey: true, authType: 'bearer' }
const codexLocal = { key: 'codex-local', enabled: true, authType: 'none' }
const h3 = { vendorKey: 'autodl-art', modelKey: 'autodl-art-h3', enabled: true }
const imagegen = { vendorKey: 'codex-local', modelKey: 'codex-imagegen', enabled: true }

describe('inspectDirectorBackends', () => {
  it('is ready when H3 has a key and imagegen is a no-auth local model', () => {
    expect(inspectDirectorBackends({ vendors: [autodl, codexLocal], models: [h3, imagegen] })).toEqual({
      stillsOk: true,
      videoOk: true,
    })
    expect(directorBackendsNeedSetup({ stillsOk: true, videoOk: true })).toBe(false)
  })

  it('flags missing AutoDL.art token even if the H3 model is enabled', () => {
    expect(inspectDirectorBackends({
      vendors: [{ ...autodl, hasApiKey: false }, codexLocal],
      models: [h3, imagegen],
    })).toEqual({ stillsOk: true, videoOk: false })
  })

  it('flags missing stills when imagegen is disabled or absent', () => {
    expect(inspectDirectorBackends({
      vendors: [autodl, codexLocal],
      models: [h3, { ...imagegen, enabled: false }],
    }).stillsOk).toBe(false)
    expect(inspectDirectorBackends({ vendors: [autodl], models: [h3] }).stillsOk).toBe(false)
  })

  it('treats enabled imagegen as ready even without a Nomi API key', () => {
    expect(inspectDirectorBackends({
      vendors: [autodl, { ...codexLocal, hasApiKey: false, authType: 'none' }],
      models: [h3, imagegen],
    }).stillsOk).toBe(true)
  })
})
