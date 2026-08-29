import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { CodexModelDto } from '../../../../electron/codexAppServer/host'
import { DIRECTOR_FALLBACK_REASONING_EFFORTS } from '../agent/directorModelSelection'

function modelKey(row: CodexModelDto): string {
  return row.model || row.id
}

function effortsFor(models: readonly CodexModelDto[], selectedModel: string): Array<{ reasoningEffort: string; description: string }> {
  const selected = selectedModel
    ? models.find((row) => modelKey(row) === selectedModel)
    : models.find((row) => row.isDefault)
  if (selected?.supportedReasoningEfforts.length) return selected.supportedReasoningEfforts
  return DIRECTOR_FALLBACK_REASONING_EFFORTS.map((reasoningEffort) => ({ reasoningEffort, description: '' }))
}

export function DirectorModelPicker({
  model,
  effort,
  onModelChange,
  onEffortChange,
}: {
  model: string
  effort: string
  onModelChange: (model: string) => void
  onEffortChange: (effort: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [models, setModels] = React.useState<CodexModelDto[]>([])
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    const list = getDesktopBridge()?.codex?.listModels
    if (!list) {
      setLoaded(true)
      return
    }
    void list().then((rows) => {
      setModels(Array.isArray(rows) ? rows : [])
    }).catch(() => {
      setModels([])
    }).finally(() => setLoaded(true))
  }, [])

  const knownModel = !model || models.some((row) => modelKey(row) === model)
  const selectValue = !loaded || models.length === 0 || knownModel ? model : ''
  const effortRows = effortsFor(models, selectValue)
  const knownEffort = !effort || effortRows.some((row) => row.reasoningEffort === effort)
  const effortValue = knownEffort ? effort : ''

  React.useEffect(() => {
    if (!loaded || models.length === 0) return
    if (model && !knownModel) onModelChange('')
  }, [loaded, knownModel, model, models.length, onModelChange])

  React.useEffect(() => {
    if (!loaded) return
    if (effort && !knownEffort) onEffortChange('')
  }, [effort, knownEffort, loaded, onEffortChange])

  const options = [
    { value: '', label: t('generationCommon.codex.model.inherit') },
    ...models.map((row) => ({
      value: modelKey(row),
      label: row.displayName || row.model || row.id,
    })),
  ]
  if (selectValue && !models.some((row) => modelKey(row) === selectValue)) {
    options.push({ value: selectValue, label: selectValue })
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-0.5" data-testid="codex-model-picker">
      <select
        aria-label={t('generationCommon.codex.model.aria')}
        className="h-7 max-w-[9rem] shrink-0 rounded-full border border-nomi-line bg-nomi-paper px-2 text-caption text-nomi-ink"
        data-testid="codex-model-select"
        value={selectValue}
        onChange={(event) => onModelChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value || 'inherit'} value={option.value}>{option.label}</option>
        ))}
      </select>
      <div className="flex gap-1" role="radiogroup" aria-label={t('generationCommon.codex.effort.aria')}>
        <WorkbenchButton
          size="sm"
          variant={effortValue === '' ? 'primary' : 'default'}
          className={cn('h-7 shrink-0 rounded-full px-2.5 text-caption')}
          aria-pressed={effortValue === ''}
          data-testid="codex-effort-inherit"
          onClick={() => onEffortChange('')}
        >
          {t('generationCommon.codex.effort.inherit')}
        </WorkbenchButton>
        {effortRows.map((row) => (
          <WorkbenchButton
            key={row.reasoningEffort}
            size="sm"
            variant={effortValue === row.reasoningEffort ? 'primary' : 'default'}
            className={cn('h-7 shrink-0 rounded-full px-2.5 text-caption')}
            title={row.description || row.reasoningEffort}
            aria-pressed={effortValue === row.reasoningEffort}
            data-testid={`codex-effort-${row.reasoningEffort}`}
            onClick={() => onEffortChange(row.reasoningEffort)}
          >
            {row.reasoningEffort}
          </WorkbenchButton>
        ))}
      </div>
    </div>
  )
}
