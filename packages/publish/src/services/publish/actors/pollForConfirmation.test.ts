import { describe, expect, test } from 'bun:test'
import { waitForArweaveConfirmation } from './pollForConfirmation'

const fast = { intervalMs: 1, timeoutMs: 200, maxConsecutiveErrors: 3 }

describe('waitForArweaveConfirmation', () => {
  test('resolves once the transaction is confirmed, riding out a few failed requests', async () => {
    const answers = [new Error('gateway down'), null, new Error('gateway down'), { confirmed: { number_of_confirmations: 1 } }]
    let calls = 0
    await waitForArweaveConfirmation(async () => {
      const answer = answers[calls++]
      if (answer instanceof Error) throw answer
      return answer
    }, 'tx', fast)
    expect(calls).toBe(4)
  })

  test('rejects after too many failed requests in a row, with the last error as cause', async () => {
    const error = await waitForArweaveConfirmation(async () => {
      throw new Error('gateway down')
    }, 'tx', fast).catch((e) => e as Error)
    expect(error.message).toContain('failed 3 times in a row')
    expect((error.cause as Error).message).toBe('gateway down')
  })

  test('rejects when it is never confirmed in time', async () => {
    const error = await waitForArweaveConfirmation(async () => ({ confirmed: null }), 'tx', {
      intervalMs: 5,
      timeoutMs: 30,
    }).catch((e) => e as Error)
    expect(error.message).toContain('was not confirmed within')
  })
})
