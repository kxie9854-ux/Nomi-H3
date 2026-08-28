import React from 'react'
import { getDesktopBridge } from '../../../desktop/bridge'
import { listWorkbenchModelCatalogModels, listWorkbenchModelCatalogVendors } from '../../api/modelCatalogApi'
import {
  directorBackendsNeedSetup,
  inspectDirectorBackends,
  type DirectorBackendSnapshot,
} from './directorBackendReady'

export function useDirectorBackendReady(): DirectorBackendSnapshot | null {
  const [snapshot, setSnapshot] = React.useState<DirectorBackendSnapshot | null>(null)

  const refresh = React.useCallback(() => {
    if (!getDesktopBridge()) {
      setSnapshot({ stillsOk: true, videoOk: true })
      return
    }
    void Promise.all([
      listWorkbenchModelCatalogVendors(),
      listWorkbenchModelCatalogModels({ enabled: true }),
    ]).then(([vendors, models]) => {
      setSnapshot(inspectDirectorBackends({ vendors, models }))
    }).catch(() => {
      setSnapshot(null)
    })
  }, [])

  React.useEffect(() => {
    refresh()
    window.addEventListener('nomi-model-catalog-changed', refresh)
    return () => window.removeEventListener('nomi-model-catalog-changed', refresh)
  }, [refresh])

  return snapshot
}

export function shouldShowDirectorBackendSetup(snapshot: DirectorBackendSnapshot | null): boolean {
  return Boolean(snapshot && directorBackendsNeedSetup(snapshot))
}
