// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getClient } from '@/client/ClientManager'
import { ResetLocalDataBrowserOnlyError } from '@/client/errors'

describe('client.resetLocalData in Node', () => {
  it('rejects with a code shared code can match on', async () => {
    const error = await getClient().resetLocalData().catch((e) => e)
    expect(error).toBeInstanceOf(ResetLocalDataBrowserOnlyError)
    expect(error.code).toBe('RESET_LOCAL_DATA_BROWSER_ONLY')
  })
})
