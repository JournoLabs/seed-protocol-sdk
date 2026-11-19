import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

/**
 * Batch 17 item 8: Node has `navigator.locks` (Bun doesn't), so publish locks work there within the
 * process. Runs publishLocks.ts in Node, which strips its types, with another holder of a lock.
 */
const script = `
const { publishLockHolder, tryHoldPublishLock } = await import(process.argv[1])
let release
await new Promise((held) =>
  navigator.locks.request('seed:publish:elsewhere', () => new Promise((done) => { release = done; held() })),
)
const answers = [await publishLockHolder('idle'), await publishLockHolder('elsewhere'), await tryHoldPublishLock('mine'), await publishLockHolder('mine')]
release()
console.log(JSON.stringify({ hasLocks: typeof navigator.locks?.request === 'function', answers }))
process.exit(0)
`

describe('publish locks in Node', () => {
  test('publishLockHolder reads navigator.locks: none, another holder, and this process', () => {
    const modulePath = fileURLToPath(new URL('./publishLocks.ts', import.meta.url))
    const out = execFileSync('node', ['--input-type=module', '-e', script, modulePath], { encoding: 'utf-8' })
    const { hasLocks, answers } = JSON.parse(out.trim().split('\n').pop()!)
    expect(hasLocks).toBe(true)
    expect(answers).toEqual(['none', 'other-tab', true, 'here'])
  })
})
