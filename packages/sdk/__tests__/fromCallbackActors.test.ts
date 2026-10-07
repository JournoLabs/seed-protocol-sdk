/**
 * Validates that fromCallback actors follow the correct pattern:
 * - They send explicit event types via sendBack (not relying on onDone)
 * - All sendBack calls include a 'type' property
 * - Async work has error handling that can send an error event
 *
 * Existing violations are listed in KNOWN_VIOLATIONS so the check still guards every other file. The
 * list must match exactly: a new violation fails the test, and so does fixing a listed file without
 * removing it from the list.
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAllFromCallbackActors, validateFromCallbackActor } from './test-utils/validateFromCallbackActors'

/** packages/sdk/src, independent of the cwd vitest runs from. */
const sdkSrcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

const ASYNC_NO_CATCH = 'async work without .catch()/try — a rejection leaves the parent machine waiting'

const KNOWN_VIOLATIONS: Record<string, string> = {
  'Item/service/actors/hydrateExistingItem.ts': ASYNC_NO_CATCH,
  'Item/service/actors/hydrateNewItem.ts': ASYNC_NO_CATCH,
  'Item/service/actors/reload.ts': ASYNC_NO_CATCH,
  'Item/service/actors/saveDataToDb.ts': ASYNC_NO_CATCH,
  'Item/service/actors/waitForDb.ts': ASYNC_NO_CATCH,
  'ItemProperty/service/actors/resolveRemoteStorage.ts': ASYNC_NO_CATCH,
  'helpers/file/download/actors.ts': ASYNC_NO_CATCH,
  'services/publish/actors/createPublishAttempt.ts': ASYNC_NO_CATCH,
  'services/publish/actors/preparePublishRequestData.ts': ASYNC_NO_CATCH,
  'services/publish/actors/upload.ts': ASYNC_NO_CATCH,
  'services/publish/actors/validateItemData.ts': ASYNC_NO_CATCH,
}

describe('fromCallback Actors Validation', () => {
  it('finds the SDK actors and reports only the known violations', async () => {
    const results = await validateAllFromCallbackActors(sdkSrcDir)

    // Guard against a wrong path silently validating nothing.
    expect(results.length).toBeGreaterThan(50)

    const invalid = Object.fromEntries(
      results
        .filter((r) => !r.isValid)
        .map((r) => [path.relative(sdkSrcDir, r.file).split(path.sep).join('/'), r.issues]),
    )

    const unexpected = Object.fromEntries(Object.entries(invalid).filter(([file]) => !(file in KNOWN_VIOLATIONS)))
    expect(unexpected, 'new fromCallback violations').toEqual({})

    const nowFixed = Object.keys(KNOWN_VIOLATIONS).filter((file) => !(file in invalid))
    expect(nowFixed, 'fixed — remove these from KNOWN_VIOLATIONS').toEqual([])
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
