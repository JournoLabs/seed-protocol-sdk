import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'

// Batch 18 item 1: the published build minifies class names, so a check that compares an error's
// `name` with `SomeClass.name` stops matching a restored error there. This runs against the built
// package; `bun run build` (or scripts/build-packages.js) must have run first.
const distEntry = new URL('../../dist/index.js', import.meta.url)

describe.skipIf(!existsSync(distEntry))('isRepeatingAttestationError in the built package', () => {
  const restore = (error: Error) => JSON.parse(JSON.stringify({ context: { error } })).context.error

  test('matches a nonce key or chain config error restored from a saved snapshot', async () => {
    const built = await import(distEntry.href)
    const nonceKey = new built.PublishNonceKeyError('no', 'NONCE_KEY_NOT_PINNED', 'k')
    const chain = new built.PublishChainConfigError(11155420, ['no EAS'])
    expect(built.isRepeatingAttestationError(restore(nonceKey))).toBe(true)
    expect(built.isRepeatingAttestationError(restore(chain))).toBe(true)
  })

  test('matches a restored error under a renamed class, as a consumer bundler produces', async () => {
    const built = await import(distEntry.href)
    // What a restored error looks like whatever the class is called in the build that threw it.
    expect(
      built.isRepeatingAttestationError({ name: 'PublishNonceKeyError', code: 'NONCE_KEY_SPENT', message: 'x' }),
    ).toBe(true)
    expect(built.isRepeatingAttestationError({ name: 'PublishChainConfigError', message: 'x' })).toBe(true)
    expect(
      built.isRepeatingAttestationError({ name: 'PublishNonceKeyError', code: 'NONCE_KEY_UNUSED', message: 'x' }),
    ).toBe(false)
  })
})
