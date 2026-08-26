import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import type { DirectorBackendSnapshot } from '../agent/directorBackendReady'

export function DirectorSetupBanner({ snapshot }: { snapshot: DirectorBackendSnapshot }): JSX.Element {
  const { t } = useTranslation()
  const missing: string[] = []
  if (!snapshot.stillsOk) missing.push(t('generationCommon.codex.setup.stills'))
  if (!snapshot.videoOk) missing.push(t('generationCommon.codex.setup.video'))
  return (
    <section
      className={cn('border-b border-nomi-line bg-nomi-ink-05 px-3 py-2')}
      data-testid="codex-backend-setup"
    >
      <p className="text-caption text-nomi-ink">
        {t('generationCommon.codex.setup.body', { missing: missing.join(t('generationCommon.codex.setup.join')) })}
      </p>
      <WorkbenchButton
        size="sm"
        className="mt-2"
        onClick={() => window.dispatchEvent(new Event('nomi-open-model-catalog'))}
      >
        {t('generationCommon.codex.setup.openModels')}
      </WorkbenchButton>
    </section>
  )
}
