import { IconCoin, IconDots, IconPlayerStopFilled, IconRobot, IconSend2, IconX } from '@tabler/icons-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiAILabel, WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { getDesktopBridge } from '../../../desktop/bridge'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import {
  getDesktopActiveProjectId,
  subscribeDesktopActiveProjectIdChange,
} from '../../../desktop/activeProject'
import { AutoGrowTextarea } from '../../ai/composer/AutoGrowTextarea'
import { handleAiComposerKeyDown } from '../../ai/aiComposerKeyboard'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { readDirectorTurnContext } from '../agent/directorTurnContext'
import {
  formatDirectorChoiceReply,
  parseDirectorChoices,
  type DirectorChoice,
} from '../agent/directorChoices'
import { humanizeDirectorActivity } from '../agent/directorActivity'
import { DIRECTOR_STAGES, inferDirectorStage, timelineSourceNodeIds, type DirectorStageId } from '../agent/directorStage'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import {
  isCurrentDirectorHistoryResponse,
  mergeDirectorHistoryLines,
  type DirectorPanelLine,
} from '../agent/directorHistoryHydration'
import { buildDirectorRestoreSummary, type DirectorRestoreSummary } from '../agent/directorRestoreSummary'
import { FOCUS_DIRECTOR_COMPOSER_EVENT } from '../nodes/nodeSizing'

type CodexEvent =
  | { kind: 'status'; ready: boolean; account: { type?: string; email?: string | null; planType?: string | null } | null; error?: string }
  | { kind: 'delta'; text: string; projectId?: string }
  | { kind: 'item'; type: string; text?: string; tool?: string; status?: string; projectId?: string }
  | { kind: 'elicitation'; requestId: string; message: string; purpose: 'spend' | 'action'; approvalScope?: string; approvalPasses?: number; projectId?: string }
  | { kind: 'turn-complete'; projectId?: string }
  | { kind: 'login-url'; url: string }
  | { kind: 'error'; message: string; projectId?: string }

type Line = DirectorPanelLine
type PendingElicitation = { requestId: string; message: string; purpose: 'spend' | 'action'; approvalScope?: string; approvalPasses?: number }
type HistoryStatus = 'idle' | 'loading' | 'ready' | 'error'

function lineId(): string {
  return `codex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function DirectorLine({
  line,
  interactive,
  onPick,
}: {
  line: Line
  interactive: boolean
  onPick: (choice: DirectorChoice) => void
}): JSX.Element {
  const { t } = useTranslation()
  const parsed = line.role === 'assistant' ? parseDirectorChoices(line.text) : { body: line.text, choices: [] as DirectorChoice[] }
  const body = parsed.body || (line.role === 'assistant' ? '…' : '')
  const choices = interactive ? parsed.choices : []
  return (
    <div data-history-origin={line.origin === 'history' ? 'true' : undefined} className={cn(
      line.role === 'user'
        ? 'border-l-2 border-nomi-accent bg-nomi-ink-05 py-1 pl-2 text-nomi-ink'
        : line.role === 'system'
          ? 'text-nomi-ink-3 text-caption'
          : 'text-nomi-ink',
    )}>
      {line.role !== 'system' ? (
        <div className="mb-1 text-caption text-nomi-ink-3">
          {t(line.role === 'user'
            ? 'generationCommon.codex.restore.userLabel'
            : 'generationCommon.codex.restore.assistantLabel')}
        </div>
      ) : null}
      <div className="whitespace-pre-wrap">{body}</div>
      {choices.length > 0 ? (
        <div className={cn('mt-2 flex flex-col gap-1.5')}>
          {choices.map((choice, index) => (
            <WorkbenchButton
              key={choice.id}
              size="sm"
              variant={index === 0 ? 'primary' : 'default'}
              className="w-full h-auto min-h-7 py-1.5 justify-start whitespace-normal text-left"
              onClick={() => onPick(choice)}
            >
              {choice.label}
            </WorkbenchButton>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DirectorRestoreBlock({ summary }: { summary: DirectorRestoreSummary }): JSX.Element {
  const { t } = useTranslation()
  return (
    <section className="border-b border-nomi-line bg-nomi-ink-05 px-3 py-2" data-testid="codex-history-restored">
      <div className="flex items-center gap-2 text-body-sm font-medium text-nomi-ink">
        <span className="size-1.5 rounded-full bg-nomi-success" aria-hidden="true" />
        {t('generationCommon.codex.restore.ready')}
      </div>
      <p className="mt-1 text-caption text-nomi-ink-60">
        {t(`generationCommon.codex.restore.summary.${summary.stage}`, {
          nodeCount: summary.nodeCount,
          completedImageCount: summary.completedImageCount,
          completedVideoCount: summary.completedVideoCount,
          timelineDuration: summary.timelineDuration,
          aspectRatio: summary.aspectRatio,
        })}
      </p>
      <p className="mt-1 text-caption text-nomi-ink-80">
        {t(`generationCommon.codex.restore.next.${summary.stage}`)}
      </p>
    </section>
  )
}

function DirectorStageStrip({ stage }: { stage: DirectorStageId }): JSX.Element {
  const { t } = useTranslation()
  const current = DIRECTOR_STAGES.indexOf(stage)
  return (
    <nav
      className={cn('flex flex-wrap items-center gap-x-1 gap-y-1 px-3 py-2 border-b border-nomi-line text-caption')}
      aria-label={t('generationCommon.codex.stageAria')}
    >
      {DIRECTOR_STAGES.map((id, index) => (
        <span key={id} className={cn('inline-flex items-center gap-1', index === current ? 'text-nomi-ink font-medium' : 'text-nomi-ink-3')}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {t(`generationCommon.codex.stage.${id}`)}
        </span>
      ))}
    </nav>
  )
}

export default function CodexDirectorPanel({
  onCollapsedChange,
}: {
  onCollapsedChange?: (collapsed: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  const collapsed = useGenerationCanvasStore((state) => state.generationAiCollapsed)
  const setCollapsed = useGenerationCanvasStore((state) => state.setGenerationAiCollapsed)
  const setDirector = useGenerationCanvasStore((state) => state.setGenerationDirector)
  const selectedCount = useGenerationCanvasStore((state) => state.selectedNodeIds.length)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [accountLabel, setAccountLabel] = React.useState('')
  const [error, setError] = React.useState('')
  const [lines, setLines] = React.useState<Line[]>([])
  const [activity, setActivity] = React.useState('')
  const [elicitation, setElicitation] = React.useState<PendingElicitation | null>(null)
  const [respondingToElicitation, setRespondingToElicitation] = React.useState(false)
  const [overflowOpen, setOverflowOpen] = React.useState(false)
  const assistantId = React.useRef<string | null>(null)
  const overflowRef = React.useRef<HTMLDivElement>(null)
  const [projectId, setProjectId] = React.useState(() => (
    getActiveWorkbenchProjectId() || getDesktopActiveProjectId() || ''
  ))
  const [historyStatus, setHistoryStatus] = React.useState<HistoryStatus>('idle')
  const [historyThreadId, setHistoryThreadId] = React.useState<string | null>(null)
  const [historyTruncated, setHistoryTruncated] = React.useState(false)
  const projectIdRef = React.useRef(projectId)
  const historyGenerationRef = React.useRef(0)
  const activeTurnProjectIdRef = React.useRef<string | null>(null)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const timeline = useWorkbenchStore((state) => state.timeline)
  const previewAspectRatio = useWorkbenchStore((state) => state.previewAspectRatio)
  const stage = inferDirectorStage(nodes, timelineSourceNodeIds(timeline))
  const restoreSummary = React.useMemo(() => buildDirectorRestoreSummary({
    nodes,
    timeline,
    aspectRatio: previewAspectRatio,
    stage,
  }), [nodes, previewAspectRatio, stage, timeline])

  React.useEffect(() => {
    onCollapsedChange?.(collapsed)
  }, [collapsed, onCollapsedChange])

  React.useEffect(() => {
    const focusComposer = () => {
      document.querySelector<HTMLTextAreaElement>('[data-testid="codex-director-composer"]')?.focus()
    }
    window.addEventListener(FOCUS_DIRECTOR_COMPOSER_EVENT, focusComposer)
    return () => window.removeEventListener(FOCUS_DIRECTOR_COMPOSER_EVENT, focusComposer)
  }, [])

  React.useEffect(() => {
    if (!overflowOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!overflowRef.current?.contains(event.target as Node)) setOverflowOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [overflowOpen])

  React.useEffect(() => subscribeDesktopActiveProjectIdChange((nextProjectId) => {
    setProjectId(nextProjectId.trim())
  }), [])

  React.useEffect(() => {
    projectIdRef.current = projectId
    const desktop = getDesktopBridge()
    const generation = historyGenerationRef.current + 1
    historyGenerationRef.current = generation
    setLines([])
    setDraft('')
    setBusy(false)
    setActivity('')
    setElicitation(null)
    setError('')
    assistantId.current = null
    setHistoryThreadId(null)
    setHistoryTruncated(false)
    if (!projectId || !desktop?.codex) {
      setHistoryStatus('ready')
      return
    }
    setHistoryStatus('loading')
    const request = { generation, projectId }
    void desktop.codex.readHistory(projectId).then((history) => {
      if (!isCurrentDirectorHistoryResponse({
        request,
        latestGeneration: historyGenerationRef.current,
        activeProjectId: projectIdRef.current,
        responseProjectId: history.projectId,
      })) return
      setLines((current) => mergeDirectorHistoryLines(history.lines, current))
      setHistoryThreadId(history.threadId)
      setHistoryTruncated(history.truncated)
      setHistoryStatus('ready')
    }).catch(() => {
      if (request.generation !== historyGenerationRef.current || request.projectId !== projectIdRef.current) return
      setHistoryStatus('error')
    })
  }, [projectId])

  React.useEffect(() => {
    const desktop = getDesktopBridge()
    if (!desktop?.codex) {
      setError(t('generationCommon.codex.unavailable'))
      return
    }
    const off = desktop.codex.onEvent((rawEvent: unknown) => {
      const event = rawEvent as CodexEvent
      if (event.kind === 'status') {
        const email = event.account?.email || ''
        const plan = event.account?.planType || event.account?.type || ''
        setAccountLabel([email, plan].filter(Boolean).join(' · '))
        if (event.error) setError(event.error)
        return
      }
      const eventProjectId = 'projectId' in event ? event.projectId : undefined
      const targetsOtherProject = Boolean(eventProjectId && eventProjectId !== projectIdRef.current)
      if (targetsOtherProject) {
        if (event.kind === 'turn-complete' && activeTurnProjectIdRef.current === eventProjectId) {
          activeTurnProjectIdRef.current = null
        }
        return
      }
      if (!eventProjectId && activeTurnProjectIdRef.current && activeTurnProjectIdRef.current !== projectIdRef.current) return
      if (event.kind === 'error') {
        if (/codex_models_manager|timeout waiting for child process to exit/i.test(event.message)) return
        const unsupported = event.message.match(/^UNHANDLED_CODEX_REQUEST:(.+)$/)
        setError(unsupported
          ? t('generationCommon.codex.unsupportedRequest', { method: unsupported[1] })
          : event.message)
        setBusy(false)
        return
      }
      if (event.kind === 'delta') {
        const id = assistantId.current
        if (!id) return
        setLines((current) => current.map((line) => (
          line.id === id ? { ...line, text: line.text + event.text } : line
        )))
        return
      }
      if (event.kind === 'item') {
        const label = humanizeDirectorActivity(event)
        if (label) setActivity(label)
        return
      }
      if (event.kind === 'elicitation') {
        setElicitation({
          requestId: event.requestId,
          message: event.message,
          purpose: event.purpose,
          ...(event.approvalScope ? { approvalScope: event.approvalScope } : {}),
          ...(event.approvalPasses ? { approvalPasses: event.approvalPasses } : {}),
        })
        setRespondingToElicitation(false)
        return
      }
      if (event.kind === 'turn-complete') {
        setBusy(false)
        setActivity('')
        assistantId.current = null
        activeTurnProjectIdRef.current = null
      }
    })
    void desktop.codex.ensure().then((status) => {
      const email = status.account?.email || ''
      const plan = status.account?.planType || status.account?.type || ''
      setAccountLabel([email, plan].filter(Boolean).join(' · '))
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
    return off
  }, [t])

  const sendText = React.useCallback((raw: string) => {
    const text = raw.trim()
    const desktop = getDesktopBridge()
    if (!text || !desktop?.codex || busy) return
    setDraft('')
    setError('')
    setActivity('')
    const replyId = lineId()
    const sendProjectId = projectId || getActiveWorkbenchProjectId() || getDesktopActiveProjectId() || ''
    activeTurnProjectIdRef.current = sendProjectId || null
    assistantId.current = replyId
    setLines((current) => [
      ...current,
      { id: lineId(), role: 'user', text, origin: 'live' },
      { id: replyId, role: 'assistant', text: '', origin: 'live' },
    ])
    setBusy(true)
    const turn = readDirectorTurnContext()
    void desktop.codex.send({
      text,
      projectId: sendProjectId || undefined,
      canvasContext: turn.canvasContext,
    }).catch((err: unknown) => {
      if (sendProjectId && sendProjectId !== projectIdRef.current) return
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [busy, projectId])

  const send = React.useCallback(() => {
    sendText(draft)
  }, [draft, sendText])

  const pickChoice = React.useCallback((choice: DirectorChoice) => {
    sendText(formatDirectorChoiceReply(choice))
  }, [sendText])

  const respondToElicitation = React.useCallback((confirmed: boolean) => {
    const desktop = getDesktopBridge()
    if (!elicitation || !desktop?.codex || respondingToElicitation) return
    setRespondingToElicitation(true)
    // 部分 app-server 构建能把 Nomi 表单转进来，却没有把 spendConfirmed 继续传给随后那次 MCP 调用。
    // 真人在这里点过后，给同项目同模型服务的 renderer 兜底门同样的明示次数上限；正常过线时它不会被消费，
    // 仍只意味着用户已明确授权过该 scope，不会放行 H3 等其它模型服务。
    if (confirmed && elicitation.purpose === 'spend' && elicitation.approvalScope) {
      useSpendConfirmStore.getState().preApproveNextAgentSpend(
        elicitation.approvalScope,
        elicitation.approvalPasses,
      )
    }
    void desktop.codex.respondElicitation(elicitation.requestId, confirmed).then(({ ok }) => {
      if (!ok) throw new Error(t('generationCommon.codex.confirmationExpired'))
      setElicitation(null)
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      setRespondingToElicitation(false)
    })
  }, [elicitation, respondingToElicitation, t])

  const lastAssistantIndex = lines.reduce((acc, line, index) => (
    line.role === 'assistant' ? index : acc
  ), -1)

  if (collapsed) {
    return (
      <aside className={cn('generation-canvas-v2-assistant', 'block w-auto h-auto rounded-full')} data-collapsed="true">
        <WorkbenchButton
          className={cn('generation-canvas-v2-assistant__launcher', 'inline-flex items-center gap-2 h-9 pl-[10px] pr-[14px]', 'border border-nomi-line rounded-full bg-nomi-paper')}
          onClick={() => setCollapsed(false)}
        >
          <NomiAILabel markSize={18} wordSize={13} suffix="Codex" />
        </WorkbenchButton>
      </aside>
    )
  }

  return (
    <aside className={cn('generation-canvas-v2-assistant', 'flex flex-col h-full min-h-0 bg-nomi-paper border-l border-nomi-line')}>
      <header className={cn('flex items-center gap-2 px-3 py-2 border-b border-nomi-line')}>
        <NomiAILabel markSize={16} wordSize={12} suffix="Codex" />
        <span className={cn('text-caption text-nomi-ink-3 truncate flex-1')}>
          {accountLabel || t('generationCommon.codex.needLogin')}
        </span>
        <div ref={overflowRef} className="relative">
          <WorkbenchIconButton
            label={t('generationCommon.codex.moreActions')}
            icon={<IconDots size={16} />}
            onClick={() => setOverflowOpen((open) => !open)}
          />
          {overflowOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 min-w-[9rem] rounded-nomi border border-nomi-line bg-nomi-paper py-1 shadow-nomi-sm">
              <WorkbenchButton
                className="w-full justify-start px-3 text-caption"
                onClick={() => {
                  setOverflowOpen(false)
                  setDirector('nomi')
                }}
              >
                {t('generationCommon.codex.switchNomi')}
              </WorkbenchButton>
            </div>
          ) : null}
        </div>
        <WorkbenchIconButton label={t('generationCommon.codex.collapse')} icon={<IconX size={16} />} onClick={() => setCollapsed(true)} />
      </header>
      <DirectorStageStrip stage={stage} />
      {busy && activity ? (
        <p className={cn('px-3 py-1.5 border-b border-nomi-line text-caption text-nomi-ink-3')}>{activity}</p>
      ) : null}
      {!accountLabel ? (
        <div className={cn('px-3 py-2 border-b border-nomi-line')}>
          <WorkbenchButton onClick={() => { void getDesktopBridge()?.codex?.login() }}>
            {t('generationCommon.codex.login')}
          </WorkbenchButton>
        </div>
      ) : null}
      {historyStatus === 'loading' ? (
        <section className="border-b border-nomi-line px-3 py-2 text-caption text-nomi-ink-3" data-testid="codex-history-loading">
          <span className="mr-2 inline-block size-1.5 animate-pulse rounded-full bg-nomi-accent motion-reduce:animate-none" aria-hidden="true" />
          {t('generationCommon.codex.restore.loading')}
        </section>
      ) : null}
      {historyStatus === 'error' ? (
        <section className="border-b border-nomi-line bg-nomi-danger-soft px-3 py-2 text-caption text-nomi-danger" data-testid="codex-history-error">
          {t('generationCommon.codex.restore.error')}
        </section>
      ) : null}
      {historyStatus === 'ready' && historyThreadId ? <DirectorRestoreBlock summary={restoreSummary} /> : null}
      <div className={cn('flex-1 min-h-0 overflow-auto px-3 py-2 space-y-2 text-body-sm')}>
        {historyTruncated ? (
          <div className="flex items-center gap-2 text-caption text-nomi-ink-3" data-testid="codex-history-truncated">
            <span className="h-px flex-1 bg-nomi-line" aria-hidden="true" />
            {t('generationCommon.codex.restore.truncated')}
            <span className="h-px flex-1 bg-nomi-line" aria-hidden="true" />
          </div>
        ) : null}
        {historyStatus === 'ready' && lines.length === 0 ? (
          <p className="text-nomi-ink-3">{t('generationCommon.codex.empty')}</p>
        ) : lines.map((line, index) => (
          <DirectorLine
            key={line.id}
            line={line}
            interactive={!busy && line.origin !== 'history' && line.role === 'assistant' && index === lastAssistantIndex}
            onPick={pickChoice}
          />
        ))}
        {elicitation ? (
          <section
            className="rounded-nomi border border-nomi-line bg-nomi-ink-05 p-3"
            role="alertdialog"
            aria-labelledby="codex-spend-confirm-title"
          >
            <div className="flex items-center gap-2 text-nomi-ink">
              <span className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-nomi',
                elicitation.purpose === 'spend'
                  ? 'bg-nomi-accent-soft text-nomi-accent'
                  : 'bg-nomi-ink text-nomi-paper',
              )}>
                {elicitation.purpose === 'spend'
                  ? <IconCoin size={18} stroke={1.5} aria-hidden="true" />
                  : <IconRobot size={18} stroke={1.5} aria-hidden="true" />}
              </span>
              <strong id="codex-spend-confirm-title" className="text-body font-medium">
                {t(elicitation.purpose === 'spend'
                  ? 'generationCommon.codex.spendTitle'
                  : 'generationCommon.codex.actionTitle')}
              </strong>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-caption text-nomi-ink-80">
              {elicitation.message || t('generationCommon.codex.confirmationFallback')}
            </p>
            <div className="mt-3 flex gap-2">
              <WorkbenchButton
                size="sm"
                variant="primary"
                disabled={respondingToElicitation}
                onClick={() => respondToElicitation(true)}
              >
                {t(elicitation.purpose === 'spend'
                  ? 'generationCommon.codex.confirmGenerate'
                  : 'generationCommon.codex.confirmContinue')}
              </WorkbenchButton>
              <WorkbenchButton
                size="sm"
                disabled={respondingToElicitation}
                onClick={() => respondToElicitation(false)}
              >
                {t('generationCommon.codex.cancelGenerate')}
              </WorkbenchButton>
            </div>
          </section>
        ) : null}
        {error ? <p className="text-nomi-danger text-caption">{error}</p> : null}
      </div>
      <footer className={cn('p-3 border-t border-nomi-line flex flex-col gap-2')}>
        {selectedCount > 0 ? (
          <p className="text-caption text-nomi-ink-3">{t('generationCommon.codex.selectionHint', { count: selectedCount })}</p>
        ) : null}
        <div className={cn('flex items-end gap-2')}>
          <AutoGrowTextarea
            data-testid="codex-director-composer"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => handleAiComposerKeyDown(event, send)}
            placeholder={selectedCount > 0 ? t('generationCommon.codex.placeholderSelected') : t('generationCommon.codex.placeholder')}
            className="flex-1"
          />
          {busy ? (
            <WorkbenchIconButton label={t('generationCommon.codex.stop')} icon={<IconPlayerStopFilled size={16} />} onClick={() => { void getDesktopBridge()?.codex?.interrupt(); setBusy(false) }} />
          ) : (
            <WorkbenchIconButton label={t('generationCommon.codex.send')} icon={<IconSend2 size={16} />} onClick={send} disabled={!draft.trim()} />
          )}
        </div>
      </footer>
    </aside>
  )
}
