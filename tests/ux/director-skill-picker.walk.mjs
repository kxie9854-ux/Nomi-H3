// Isolated Electron walk: director skill chips, import, and export IPC.
// Does not send a Codex turn or spend H3 credit.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { createBlankProject, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'

const require = createRequire(import.meta.url)
const tscBin = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
const shotsDir = path.join(repoRoot, 'tests', 'ux', 'shots')
fs.mkdirSync(shotsDir, { recursive: true })

function compileElectron() {
  const result = spawnSync(process.execPath, [tscBin, '-p', 'electron/tsconfig.json'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env },
  })
  if (result.status) throw new Error(`electron tsc failed: ${result.status}`)
}

compileElectron()

const skillMd = path.join(os.tmpdir(), 'nomi-walk-night-market.md')
fs.writeFileSync(skillMd, `---
name: night-market
description: Night market overlay for the walk.
---

# Night market

Use lantern light and wet pavement.
`)

const launched = await launchNomiApp({
  name: 'director-skill-picker',
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

try {
  const { win, projectsDir } = launched
  await dismissSplashIfPresent(win)
  await createBlankProject(win, projectsDir)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 10_000 })
  await win.waitForTimeout(1_200)

  const startDirector = win.getByRole('button', { name: '开始导演' })
  if (await startDirector.isVisible().catch(() => false)) await startDirector.click()

  const panel = win.locator('aside.generation-canvas-v2-assistant').filter({ has: win.getByTestId('codex-director-composer') }).or(
    win.locator('aside.generation-canvas-v2-assistant'),
  ).first()
  await panel.waitFor({ state: 'visible', timeout: 15_000 })
  if (await panel.getAttribute('data-collapsed') === 'true') {
    await panel.getByRole('button').first().click()
  }
  const composer = win.getByTestId('codex-director-composer')
  if (!await composer.isVisible().catch(() => false)) {
    const switchCodex = win.getByRole('button', { name: 'Codex', exact: true }).first()
    if (await switchCodex.isVisible().catch(() => false)) await switchCodex.click()
  }
  await composer.waitFor({ state: 'visible', timeout: 15_000 })

  const picker = win.getByTestId('codex-skill-picker')
  await picker.waitFor({ state: 'visible', timeout: 15_000 })
  const film = win.getByTestId('codex-skill-mode-film')
  const none = win.getByTestId('codex-skill-mode-none')
  const author = win.getByTestId('codex-skill-mode-author')
  await film.waitFor({ state: 'visible', timeout: 10_000 })
  check(await film.getAttribute('aria-pressed') === 'true', '成片模式默认开启')
  await none.click()
  check(await none.getAttribute('aria-pressed') === 'true', '可切到无技能')
  check(await film.getAttribute('aria-pressed') !== 'true', '无技能时成片关掉')
  await author.click()
  check(await author.getAttribute('aria-pressed') === 'true', '可切到创建技能')
  await film.click()
  check(await film.getAttribute('aria-pressed') === 'true', '可切回成片')

  const guzhuang = win.getByTestId('codex-skill-director-guzhuang')
  await guzhuang.waitFor({ state: 'visible', timeout: 8_000 })
  check(await guzhuang.getAttribute('aria-pressed') !== 'true', '古装默认未选')
  await guzhuang.click()
  check(await guzhuang.getAttribute('aria-pressed') === 'true', '点古装后选中')

  const listed = await win.evaluate(async () => {
    const skills = await window.nomiDesktop?.codex?.listSkills?.()
    return Array.isArray(skills) ? skills.map((item) => item.id) : null
  })
  check(Array.isArray(listed) && listed[0] === 'h3-autodl-art-director', 'listSkills 脊柱在第一位', String(listed?.[0]))
  check(Array.isArray(listed) && listed.includes('director-guzhuang'), 'listSkills 含古装')

  const fileInput = picker.locator('input[type="file"]')
  await fileInput.setInputFiles(skillMd)
  const importedChip = picker.getByRole('button', { name: 'night-market' })
  await importedChip.waitFor({ state: 'visible', timeout: 10_000 })
  check(await importedChip.getAttribute('aria-pressed') === 'true', '导入 SKILL.md 后自动选中')

  const shot = path.join(shotsDir, 'director-skill-picker.png')
  await win.screenshot({ path: shot, fullPage: false })
  console.log(JSON.stringify({ ok: failures.length === 0, shot, listed, failures }, null, 2))
  if (failures.length) throw new Error(failures.join('\n'))
} finally {
  await launched.close()
  fs.rmSync(skillMd, { force: true })
}
