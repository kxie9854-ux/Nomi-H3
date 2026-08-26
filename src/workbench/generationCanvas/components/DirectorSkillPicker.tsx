import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlus } from '../../../vendor/tablerIcons'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { DirectorSkillDto } from '../../../../electron/codexAppServer/directorSkills'
import {
  toggleDirectorSkillId,
  type DirectorSkillMode,
} from '../agent/directorSkillSelection'

const MODES: DirectorSkillMode[] = ['none', 'film', 'author']

export function DirectorSkillPicker({
  mode,
  onModeChange,
  selectedIds,
  onChange,
  onError,
}: {
  mode: DirectorSkillMode
  onModeChange: (mode: DirectorSkillMode) => void
  selectedIds: readonly string[]
  onChange: (ids: string[]) => void
  onError: (message: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [skills, setSkills] = React.useState<DirectorSkillDto[]>([])
  const [importing, setImporting] = React.useState(false)

  const refresh = React.useCallback(() => {
    const list = getDesktopBridge()?.codex?.listSkills
    if (!list) return
    void list().then(setSkills).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : String(error))
    })
  }, [onError])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const labelFor = (skill: DirectorSkillDto): string => {
    if (skill.spine) return t('generationCommon.codex.skill.spine')
    if (skill.origin === 'builtin') {
      return t(`generationCommon.codex.skill.templates.${skill.id}` as 'generationCommon.codex.skill.templates.director-guzhuang')
    }
    return skill.label
  }

  const importFile = (file: File | undefined) => {
    if (!file) return
    const desktop = getDesktopBridge()?.codex?.importSkill
    if (!desktop) {
      onError(t('generationCommon.codex.unavailable'))
      return
    }
    setImporting(true)
    const reader = new FileReader()
    reader.onload = () => {
      const markdown = typeof reader.result === 'string' ? reader.result : ''
      void desktop({ markdown, fileName: file.name }).then((imported) => {
        refresh()
        onChange(toggleDirectorSkillId(selectedIds, imported.id))
      }).catch((error: unknown) => {
        onError(error instanceof Error ? error.message : t('generationCommon.codex.skill.importFailed'))
      }).finally(() => setImporting(false))
    }
    reader.onerror = () => {
      setImporting(false)
      onError(t('generationCommon.codex.skill.emptyImport'))
    }
    reader.readAsText(file)
  }

  const overlays = skills.filter((skill) => !skill.spine)
  const hintKey = mode === 'none'
    ? 'generationCommon.codex.skill.pickerHintNone'
    : mode === 'author'
      ? 'generationCommon.codex.skill.pickerHintAuthor'
      : 'generationCommon.codex.skill.pickerHint'

  return (
    <div className="flex flex-col gap-1" data-testid="codex-skill-picker">
      <div className="flex gap-1 overflow-x-auto pb-0.5" role="radiogroup" aria-label={t('generationCommon.codex.skill.modeAria')}>
        {MODES.map((id) => (
          <WorkbenchButton
            key={id}
            size="sm"
            variant={mode === id ? 'primary' : 'default'}
            className={cn('h-7 shrink-0 rounded-full px-2.5 text-caption')}
            aria-pressed={mode === id}
            data-testid={`codex-skill-mode-${id}`}
            onClick={() => onModeChange(id)}
          >
            {t(`generationCommon.codex.skill.mode.${id}` as 'generationCommon.codex.skill.mode.film')}
          </WorkbenchButton>
        ))}
      </div>
      {mode === 'film' ? (
        <div className="flex gap-1 overflow-x-auto pb-0.5" role="listbox" aria-label={t('generationCommon.codex.skill.aria')} aria-multiselectable="true">
          {overlays.map((skill) => {
            const selected = selectedIds.includes(skill.id)
            return (
              <WorkbenchButton
                key={skill.id}
                size="sm"
                variant={selected ? 'primary' : 'default'}
                className={cn('h-7 shrink-0 rounded-full px-2.5 text-caption')}
                title={skill.description || labelFor(skill)}
                aria-pressed={selected}
                data-testid={`codex-skill-${skill.id}`}
                onClick={() => onChange(toggleDirectorSkillId(selectedIds, skill.id))}
              >
                {labelFor(skill)}
              </WorkbenchButton>
            )
          })}
          <WorkbenchButton
            size="sm"
            className="h-7 shrink-0 rounded-full px-2.5 text-caption gap-1"
            disabled={importing}
            aria-label={t('generationCommon.codex.skill.importAria')}
            onClick={() => inputRef.current?.click()}
          >
            <IconPlus size={14} stroke={1.5} />
            {t('generationCommon.codex.skill.import')}
          </WorkbenchButton>
        </div>
      ) : null}
      <p className="text-caption text-nomi-ink-3">{t(hintKey)}</p>
      <input
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        className="hidden"
        onChange={(event) => {
          importFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
