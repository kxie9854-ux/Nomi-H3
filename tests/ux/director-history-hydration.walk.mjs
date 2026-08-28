// R13/R16 real-project walkthrough for project-level Codex director recovery.
// It is intentionally opt-in because success history must come from an already
// bound real Codex thread. The walk is read-only: it opens the project/panel,
// captures the user-visible result, and never sends a turn or accepts a gate.
//
// NOMI_DIRECTOR_USER_DATA=/absolute/profile node tests/ux/director-history-hydration.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'

const userDataDir = String(process.env.NOMI_DIRECTOR_USER_DATA || '').trim()
if (!path.isAbsolute(userDataDir)) {
  throw new Error('NOMI_DIRECTOR_USER_DATA 必须是已绑定导演 thread 的绝对 userData 路径')
}

const projectsDir = path.join(userDataDir, 'projects')
const shotsDir = path.join(repoRoot, 'tests', 'ux', 'shots')
fs.mkdirSync(shotsDir, { recursive: true })
const screenshotPath = path.join(shotsDir, 'director-history-restored.png')

const launched = await launchNomiApp({
  name: 'director-history-hydration',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  settleMs: 2_000,
})

try {
  let win = launched.win
  const pickMainWindow = () => {
    const candidate = launched.app.windows().find((page) => {
      try { return /(?:index\.html|127\.0\.0\.1)/.test(page.url()) && !page.url().startsWith('devtools:') } catch { return false }
    })
    if (candidate) win = candidate
    return win
  }
  pickMainWindow()
  const splashSkip = win.locator('[data-splash-skip="true"]')
  if (await splashSkip.isVisible().catch(() => false)) {
    await splashSkip.click({ timeout: 5_000 }).catch(async () => {
      await win.evaluate(() => {
        const button = document.querySelector('[data-splash-skip="true"]')
        if (button instanceof HTMLElement) button.click()
      })
    })
    await win.locator('.nomi-splash').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
  }

  const generationTab = win.getByRole('button', { name: '生成', exact: true }).first()
  if (!await generationTab.isVisible().catch(() => false)) {
    const preferredProject = win.locator('[data-project-card="true"]', { hasText: '08_25 00_09' }).first()
    const fallbackProject = win.locator('[data-project-card="true"]').first()
    const card = await preferredProject.isVisible().catch(() => false) ? preferredProject : fallbackProject
    await card.click({ timeout: 10_000 })
    await win.waitForTimeout(1_500)
    pickMainWindow()
  }

  await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: 10_000 })
  const panel = win.locator('aside.generation-canvas-v2-assistant').first()
  await panel.waitFor({ state: 'visible', timeout: 10_000 })
  if (await panel.getAttribute('data-collapsed') === 'true') await panel.getByRole('button').first().click()

  const switchCodex = win.getByRole('button', { name: 'Codex', exact: true }).first()
  if (await switchCodex.isVisible().catch(() => false)) await switchCodex.click()

  const restored = win.getByTestId('codex-history-restored')
  await restored.waitFor({ state: 'visible', timeout: 90_000 })
  const restoredText = await restored.innerText()
  if (!restoredText.includes('已恢复这个项目')) throw new Error(`恢复卡文案异常：${restoredText}`)
  if (!/时间轴\s+0:10/.test(restoredText) || !restoredText.includes('9:16')) {
    throw new Error(`恢复卡没有忠实反映真实时间轴：${restoredText}`)
  }
  if (!restoredText.includes('最终审片') || !restoredText.includes('导出')) {
    throw new Error(`恢复卡没有给出获批的下一步：${restoredText}`)
  }

  const historicalChoiceButtons = panel.locator('[data-history-origin="true"] button')
  if (await historicalChoiceButtons.count()) throw new Error('历史消息仍包含可点击的旧选择')

  await win.screenshot({ path: screenshotPath })
  console.log(JSON.stringify({ ok: true, screenshotPath, restoredText }, null, 2))
} finally {
  await launched.close()
}
