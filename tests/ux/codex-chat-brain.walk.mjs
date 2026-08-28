// Isolated walk: Codex 本地卡文案 + 开启后助手下拉里出现「Codex 对话」.
// 不发 Codex 轮、不烧 H3 额度。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { createBlankProject, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'

const shotsDir = path.join(repoRoot, 'tests', 'ux', 'shots')
fs.mkdirSync(shotsDir, { recursive: true })

const launched = await launchNomiApp({
  name: 'codex-chat-brain',
  settleMs: 2_000,
  env: {
    NOMI_DESKTOP_DEV: '1',
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5273',
  },
})

const failures = []
const check = (ok, label, detail = '') => {
  if (ok) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures.push(`${label}${detail ? `: ${detail}` : ''}`)
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const pageErrors = []
const consoleErrors = []

try {
  const { win, projectsDir, settingsDir } = launched
  win.on('pageerror', (error) => pageErrors.push(String(error)))
  win.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await dismissSplashIfPresent(win)
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
  })
  await createBlankProject(win, projectsDir)
  await win.waitForTimeout(600)
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')))
  await win.waitForTimeout(900)

  const localGroup = win.locator('button', { hasText: /本地运行时|即梦会员/ }).first()
  if (await localGroup.count()) await localGroup.click({ timeout: 2500 }).catch(() => {})
  await win.waitForTimeout(400)

  const card = win.getByText('Codex 本地', { exact: true }).first()
  await card.scrollIntoViewIfNeeded()
  check(await card.count() > 0, '模型接入能看到 Codex 本地卡')
  await card.click()
  await win.waitForTimeout(700)
  const detailText = await win.locator('[data-settings-page="models"]').innerText()
  check(detailText.includes('对话和出图') || detailText.includes('对话和生成图片'), '卡文案覆盖对话而不只出图')
  await win.screenshot({ path: path.join(shotsDir, 'codex-chat-card.png') })

  const turnOn = win.getByRole('button', { name: '开启 Codex 本地' })
  if (await turnOn.isVisible().catch(() => false)) {
    await turnOn.click()
    await win.waitForTimeout(800)
  }
  check(await win.getByText('助手和图片节点都可以选 Codex 了').count() > 0, '开启后出现就绪说明')

  await win.locator('[data-settings-close]').click({ timeout: 5_000 })
  await win.locator('[data-settings-overlay]').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  await win.waitForTimeout(500)

  await win.locator('[aria-label="工作区切换"]').getByText('创作', { exact: true }).click({ timeout: 10_000 }).catch(() => {})
  await win.waitForTimeout(800)

  const openCreationAi = async () => {
    const picker = win.getByLabel('助手模型')
    if (await picker.isVisible().catch(() => false)) return picker
    const expand = win.getByRole('button', { name: /展开.*助手|创作助手/ })
    if (await expand.isVisible().catch(() => false)) await expand.click()
    await win.waitForTimeout(500)
    return win.getByLabel('助手模型')
  }

  let picker = await openCreationAi()
  if (!await picker.isVisible().catch(() => false)) {
    await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 8_000 })
    await win.waitForTimeout(1_000)
    const startDirector = win.getByRole('button', { name: '开始导演' })
    if (await startDirector.isVisible().catch(() => false)) await startDirector.click()
    await win.waitForTimeout(800)
    const switchNomi = win.getByRole('button', { name: 'Nomi 助手' })
    if (await switchNomi.isVisible().catch(() => false)) await switchNomi.click()
    await win.waitForTimeout(800)
    picker = win.getByLabel('助手模型')
  }

  check(await picker.isVisible().catch(() => false), '助手模型选择器可见')
  if (await picker.isVisible().catch(() => false)) {
    await picker.click()
    await win.waitForTimeout(400)
    const options = await win.locator('[role="option"]').allTextContents()
    check(options.some((label) => label.includes('Codex 对话')), '下拉里有 Codex 对话', options.join(' | ') || '(empty)')
    await win.screenshot({ path: path.join(shotsDir, 'codex-chat-picker.png') })
  }

  const catalogPath = path.join(settingsDir, 'model-catalog.json')
  if (fs.existsSync(catalogPath)) {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
    const chat = (catalog.models || []).find((model) => model.vendorKey === 'codex-local' && model.modelKey === 'codex-chat')
    const vendor = (catalog.vendors || []).find((item) => item.key === 'codex-local')
    check(Boolean(chat && chat.kind === 'text' && chat.enabled), '隔离 catalog 种出启用的 codex-chat')
    check(Boolean(vendor && vendor.enabled && vendor.authType === 'none'), 'codex-local 已开启且不要 key')
  } else {
    check(false, '隔离 catalog 已落盘')
  }

  const noisy = consoleErrors.filter((text) =>
    !/Download the React DevTools/i.test(text)
    && !/Autofill\./i.test(text)
    && !/vite.*connecting/i.test(text),
  )
  check(pageErrors.length === 0, '渲染层无 pageerror', pageErrors.join(' | '))
  check(noisy.length === 0, '渲染层无产品 console.error', noisy.slice(0, 5).join(' | '))
} finally {
  await launched.close()
}

if (failures.length) {
  console.error(`\nFAILED ${failures.length}:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('\ncodex-chat-brain walk passed')
