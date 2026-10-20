import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import yaml from 'js-yaml'
import { jobSteps, parseArgs } from '../ci-local.js'

const workflow = yaml.load(fs.readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'))

describe('jobSteps', () => {
  it('reads the Lint and test job in workflow order', () => {
    const commands = jobSteps(workflow).map((step) => step.command)
    const order = ['bun install --frozen-lockfile', 'bun run lint', 'node scripts/build-packages.js', 'bun run test']
    const positions = order.map((prefix) => commands.findIndex((command) => command.startsWith(prefix)))
    assert.ok(positions.every((index) => index >= 0), `missing a step in ${JSON.stringify(commands)}`)
    assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  })

  it('keeps literal step env and drops GitHub expressions', () => {
    const steps = jobSteps({
      jobs: { test: { steps: [{ uses: 'x' }, { run: 'a', env: { SKIP_TESTS: '1', KEY: '${{ secrets.KEY }}' } }] } },
    })
    assert.deepEqual(steps, [{ command: 'a', env: { SKIP_TESTS: '1' } }])
  })

  it('drops --with-deps from playwright install', () => {
    const [step] = jobSteps({ jobs: { test: { steps: [{ run: 'bunx playwright install --with-deps chromium' }] } } })
    assert.equal(step.command, 'bunx playwright install chromium')
  })
})

describe('parseArgs', () => {
  it('parses --repeat and --docker', () => {
    assert.deepEqual(parseArgs(['--docker', '--repeat', '3']), { repeat: 3, docker: true, cpus: '2', memory: '7g' })
  })

  it('rejects a bad --repeat', () => {
    assert.throws(() => parseArgs(['--repeat', '0']))
  })
})
