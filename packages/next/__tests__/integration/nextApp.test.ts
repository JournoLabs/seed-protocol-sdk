/// <reference lib="dom" />
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'

// Builds the fixture app (which uses withSeed from this package's dist) with each bundler,
// serves it with `next start`, and checks a real browser can init the SDK, create an item and
// still see it after a reload (OPFS persistence). Needs packages/next, sdk and react built.

const testDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(testDir, '../..')
const fixtureDir = path.resolve(testDir, '../fixtures/next-app')
const nextBin = createRequire(path.join(packageDir, 'package.json')).resolve('next/dist/bin/next')

const BUILD_TIMEOUT_MS = 300_000

for (const file of [
  path.join(packageDir, 'dist/index.js'),
  path.resolve(packageDir, '../sdk/dist/main.js'),
  path.resolve(packageDir, '../react/dist/index.js'),
]) {
  if (!fs.existsSync(file)) {
    throw new Error(`${path.relative(packageDir, file)} is missing: build packages/next, sdk and react before this test.`)
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

async function waitForServer(url: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited early:\n${output()}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`next start did not answer at ${url}:\n${output()}`)
}

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch()
}, 60_000)

// Closing Chromium can take a while when the rest of the suite loads the machine. Don't let a slow
// close fail the run: the process exit cleans it up either way.
afterAll(async () => {
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 20_000))])
}, 30_000)

function stopServer(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 10_000)
    child.once('exit', () => {
      clearTimeout(force)
      resolve()
    })
    child.kill()
  })
}

describe.each([
  { bundler: 'turbopack', buildArgs: [] as string[] },
  { bundler: 'webpack', buildArgs: ['--webpack'] },
])('Next.js app built with $bundler', ({ bundler, buildArgs }) => {
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', SEED_NEXT_DIST_DIR: `.next-${bundler}` }
  let server: ChildProcess | undefined
  let baseUrl = ''

  beforeAll(async () => {
    fs.rmSync(path.join(fixtureDir, `.next-${bundler}`), { recursive: true, force: true })
    const build = spawnSync(process.execPath, [nextBin, 'build', ...buildArgs], {
      cwd: fixtureDir,
      env,
      encoding: 'utf8',
      timeout: BUILD_TIMEOUT_MS,
    })
    const buildOutput = `${build.stdout}\n${build.stderr}`
    if (build.status !== 0) throw new Error(`next build failed:\n${buildOutput}`)
    // withSeed keeps the SDK's Node code out of the server build, so nothing should warn.
    expect(buildOutput).not.toMatch(/warning/i)

    const port = await freePort()
    baseUrl = `http://127.0.0.1:${port}`
    let serverOutput = ''
    server = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: fixtureDir,
      env,
    })
    server.stdout?.on('data', (chunk) => (serverOutput += chunk))
    server.stderr?.on('data', (chunk) => (serverOutput += chunk))
    await waitForServer(baseUrl, server, () => serverOutput)
  }, BUILD_TIMEOUT_MS + 90_000)

  afterAll(() => stopServer(server), 30_000)

  it('sends the cross-origin isolation headers on pages and static chunks', async () => {
    const page = await fetch(baseUrl)
    const html = await page.text()
    const chunk = html.match(/\/_next\/static\/chunks\/[^"']+\.js/)?.[0]
    expect(chunk).toBeTruthy()
    for (const response of [page, await fetch(`${baseUrl}${chunk}`)]) {
      expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin')
      expect(response.headers.get('cross-origin-embedder-policy')).toBe('credentialless')
      expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    }
  })

  it('inits the SDK, creates an item and keeps it across a reload', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    const count = () => page.locator('[data-testid=count]').textContent()
    const settled = () =>
      page.waitForFunction(() => {
        const text = document.querySelector('[data-testid=count]')?.textContent
        return text !== undefined && text !== 'loading'
      }, null, { timeout: 30_000 })

    try {
      await page.goto(baseUrl)
      await page.waitForSelector('[data-testid=ready]', { timeout: 60_000 }).catch(async (error) => {
        const initError = await page.evaluate(() => (window as { __seedInitError?: string }).__seedInitError)
        throw new Error(`client never became ready: ${initError ?? error}\n${errors.join('\n')}`)
      })
      expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true)
      await settled()
      expect(await count()).toBe('0')

      await page.click('[data-testid=create]')
      await page.waitForFunction(() => document.querySelector('[data-testid=created]')?.textContent, null, {
        timeout: 30_000,
      })
      await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.textContent === '1', null, {
        timeout: 30_000,
      })

      await page.reload()
      await page.waitForSelector('[data-testid=ready]', { timeout: 60_000 })
      await settled()
      await page.waitForFunction(() => document.querySelector('[data-testid=count]')?.textContent === '1', null, {
        timeout: 30_000,
      })
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  }, 180_000)
})
