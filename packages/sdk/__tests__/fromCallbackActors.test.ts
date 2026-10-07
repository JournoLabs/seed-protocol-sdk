/**
 * Validates that fromCallback actors follow the correct pattern:
 * - They send explicit event types via sendBack (not relying on onDone)
 * - All sendBack calls include a 'type' property
 * - Async work has error handling that can send an error event
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAllFromCallbackActors, validateFromCallbackActor } from './test-utils/validateFromCallbackActors'

/** packages/sdk/src, independent of the cwd vitest runs from. */
const sdkSrcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

describe('fromCallback Actors Validation', () => {
  it('finds the SDK actors and reports no violations', async () => {
    const results = await validateAllFromCallbackActors(sdkSrcDir)

    // Guard against a wrong path silently validating nothing.
    expect(results.length).toBeGreaterThan(30)

    const invalid = Object.fromEntries(
      results
        .filter((r) => !r.isValid)
        .map((r) => [path.relative(sdkSrcDir, r.file).split(path.sep).join('/'), r.issues]),
    )

    expect(invalid, 'fromCallback violations').toEqual({})
  })

  describe('validator', () => {
    const check = (code: string) => validateFromCallbackActor('x.ts', code).issues

    it('accepts typed sendBack calls with error handling, ignoring destructuring and comments', () => {
      expect(check(`
        export const a = fromCallback(({ sendBack, input }) => {
          // callback actors don't trigger onDone
          run().then(() => sendBack({
            type: 'aSuccess',
          })).catch((error) => sendBack({ type: 'aError', error }))
        })
      `)).toEqual([])
    })

    it('flags untyped sendBack, bare done events, onDone and missing error handling', () => {
      const issues = check(`
        export const a = fromCallback(({ sendBack }) => {
          run().then((x) => { sendBack(x); sendBack({ type: 'done' }) })
        })
        const m = { invoke: { src: 'a', onDone: {} } }
      `)
      expect(issues).toEqual([
        expect.stringContaining("missing 'type'"),
        expect.stringContaining("uses 'done'"),
        expect.stringContaining('onDone'),
        expect.stringContaining('no error handling'),
      ])
    })
  })
})
