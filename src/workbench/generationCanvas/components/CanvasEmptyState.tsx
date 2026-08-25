// 空画布引导：本 fork 主路径是对 Codex 说话，不是手建一张空图。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'

type CanvasEmptyStateProps = {
  activeCategoryId: string
  onStartDirector: () => void
  onCreate: () => void
}

export function CanvasEmptyState({
  activeCategoryId,
  onStartDirector,
  onCreate,
}: CanvasEmptyStateProps): JSX.Element {
  const { t } = useTranslation()
  const supportedCategories = new Set(['shots', 'cast', 'scene', 'prop', 'audio'])
  const categoryKey = supportedCategories.has(activeCategoryId) ? activeCategoryId : 'fallback'
  const activeCategoryName = t(`generationCommon.canvas.empty.categories.${categoryKey}`)
  return (
    <div
      className={cn(
        'absolute top-[44%] left-1/2 grid gap-3 place-items-center',
        'text-workbench-muted text-body-sm text-center',
        '-translate-x-1/2 -translate-y-1/2',
      )}
    >
      <strong className="text-body text-nomi-ink">
        {t('generationCommon.canvas.empty.directorTitle')}
      </strong>
      <span className="text-caption text-nomi-ink-60 max-w-[320px]">
        {t('generationCommon.canvas.empty.directorDescription')}
      </span>
      <WorkbenchButton
        className={cn(
          'mt-2 inline-flex items-center gap-1.5 min-h-[28px] px-4',
          'rounded-full border-0 bg-nomi-ink text-nomi-paper',
          'font-[inherit] text-caption font-medium',
          'hover:enabled:bg-nomi-accent',
        )}
        aria-label={t('generationCommon.canvas.empty.startDirectorAria')}
        onClick={onStartDirector}
      >
        {t('generationCommon.canvas.empty.startDirector')}
      </WorkbenchButton>
      <WorkbenchButton
        className="border-0 bg-transparent text-caption text-nomi-ink-60 shadow-none hover:bg-transparent hover:text-nomi-ink"
        aria-label={t('generationCommon.canvas.empty.createAria', { category: activeCategoryName })}
        onClick={onCreate}
      >
        {t('generationCommon.canvas.empty.createManual', { category: activeCategoryName })}
      </WorkbenchButton>
    </div>
  )
}
