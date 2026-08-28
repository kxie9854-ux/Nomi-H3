// One-time, explicitly opt-in repair for a legacy project whose preview aspect
// predates project-level aspect persistence. This deliberately uses the visible
// preview control instead of editing project.json behind Nomi's back, so the
// same walk proves the UI -> Zustand -> autosave path that users rely on.
//
// NOMI_DIRECTOR_USER_DATA=/absolute/profile \
// NOMI_DIRECTOR_PROJECT_HINT='08_25 00_09' \
// node tests/ux/director-project-aspect-repair.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'

const userDataDir = String(process.env.NOMI_DIRECTOR_USER_DATA || '').trim()
const projectHint = String(process.env.NOMI_DIRECTOR_PROJECT_HINT || '').trim()
if (!path.isAbsolute(userDataDir) || !projectHint) {
  throw new Error('必须提供绝对 NOMI_DIRECTOR_USER_DATA 与 NOMI_DIRECTOR_PROJECT_HINT')
}

const projectsDir = path.join(userDataDir, 'projects')
const projectDirName = fs.readdirSync(projectsDir).find((name) => name.includes(projectHint))
if (!projectDirName) throw new Error(`找不到匹配项目：${projectHint}`)
const manifestPath = path.join(projectsDir, projectDirName, '.nomi', 'project.json')
const projectName = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).name

const launched = await launchNomiApp({
  name: 'director-project-aspect-repair',
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

  const previewTab = win.getByRole('button', { name: '预览', exact: true }).first()
  if (!await previewTab.isVisible().catch(() => false)) {
    const projectCard = win.locator('[data-project-card="true"]', { hasText: projectName }).first()
    if (!await projectCard.isVisible().catch(() => false)) {
      const bodyText = await win.locator('body').innerText().catch(() => '')
      throw new Error(`项目库没有出现目标卡片；当前窗口=${win.url()}；可见文字=${bodyText.slice(0, 1500)}`)
    }
    await projectCard.click({ timeout: 10_000 })
    await win.waitForTimeout(1_500)
    pickMainWindow()
  }

  await win.getByRole('button', { name: '预览', exact: true }).first().click({ timeout: 10_000 })
  const aspectControl = win.getByRole('button', { name: '预览画幅', exact: true })
  await aspectControl.waitFor({ state: 'visible', timeout: 15_000 })
  await aspectControl.click()
  await win.getByRole('option', { name: '9:16', exact: true }).click({ timeout: 5_000 })

  const deadline = Date.now() + 10_000
  let persisted
  while (Date.now() < deadline) {
    persisted = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (persisted.payload?.previewAspectRatio === '9:16') break
    await win.waitForTimeout(250)
  }
  if (persisted?.payload?.previewAspectRatio !== '9:16') {
    throw new Error(`画幅没有落盘：${manifestPath}`)
  }
  console.log(JSON.stringify({ ok: true, manifestPath, previewAspectRatio: persisted.payload.previewAspectRatio }, null, 2))
} finally {
  await launched.close()
}
