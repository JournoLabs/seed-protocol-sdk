// Spike probe: init, create a note, reload, check the note persisted; plus a nested-worker check.
import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url))
const { chromium } = require('playwright')

const targets = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chromium' })
for (const base of targets) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const logs = []
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 220)}`)
  })
  context.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${new URL(r.url()).pathname}`) })
  page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 220)}`))
  const text = async (id) => (await page.locator(`[data-testid=${id}]`).textContent())?.trim()

  await page.goto(base)
  await page.waitForSelector('[data-testid=ready]', { timeout: 60_000 })
  await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.textContent !== 'loading', null, { timeout: 30_000 }).catch(() => {})
  const before = await text('count')
  await page.click('[data-testid=create]')
  await page.waitForFunction(() => document.querySelector('[data-testid=created]')?.textContent, null, { timeout: 30_000 })
  await page.waitForTimeout(1500)
  const created = await text('created')
  const afterCreate = await text('count')
  await page.reload()
  await page.waitForSelector('[data-testid=ready]', { timeout: 60_000 })
  await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.textContent !== 'loading', null, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const afterReload = await text('count')

  const nested = await page.evaluate(() => new Promise((res) => {
    const w = new Worker('/nested-test.js')
    w.onmessage = (m) => res(m.data)
    w.onerror = (e) => res({ outerError: e.message || e.type })
    w.postMessage({ url: location.origin + '/nested-test.js' })
    setTimeout(() => res('timeout'), 4000)
  }))

  console.log(JSON.stringify({ base, isolated: await text('isolated'), before, created, afterCreate, afterReload, logs: [...new Set(logs)] }, null, 1))
  await context.close()
}
await browser.close()
