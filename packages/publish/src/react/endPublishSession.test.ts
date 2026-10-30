import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

const disconnectPublishWallet = mock(async () => {})
mock.module('../helpers/thirdweb', () => ({ disconnectPublishWallet }))

const { PublishManager } = await import('../services/publishManager')
const { endPublishSession } = await import('./endPublishSession')

const stopAll = spyOn(PublishManager, 'stopAll').mockImplementation(() => {})

afterEach(() => {
  stopAll.mockClear()
  disconnectPublishWallet.mockClear()
})

describe('endPublishSession', () => {
  test('stops publishes once the disconnect has finished', async () => {
    let finishDisconnect = () => {}
    disconnectPublishWallet.mockImplementationOnce(() => new Promise<void>((resolve) => (finishDisconnect = resolve)))

    const ended = endPublishSession()
    expect(stopAll).not.toHaveBeenCalled()
    finishDisconnect()
    await ended

    expect(stopAll).toHaveBeenCalledTimes(1)
  })

  test('a failed disconnect resolves and still stops publishes', async () => {
    disconnectPublishWallet.mockImplementationOnce(async () => {
      throw new Error('no config')
    })

    await expect(endPublishSession()).resolves.toBeUndefined()

    expect(stopAll).toHaveBeenCalledTimes(1)
  })
})
