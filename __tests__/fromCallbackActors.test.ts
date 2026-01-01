/**
 * Test to validate that all fromCallback actors follow the correct pattern:
 * - They send explicit event types via sendBack (not relying on onDone)
 * - All sendBack calls include a 'type' property
 * - Error handling sends explicit error events
 * 
 * This test will catch any future violations of the fromCallback pattern.
 */

import { describe, it } from 'vitest'
import { createFromCallbackValidationTest } from './test-utils/validateFromCallbackActors'

describe('fromCallback Actors Validation', () => {
  it('should validate all fromCallback actors send explicit event types', async () => {
    const test = createFromCallbackValidationTest()
    await test()
  })
})

