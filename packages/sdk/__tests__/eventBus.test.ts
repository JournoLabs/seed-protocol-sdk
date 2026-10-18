import { describe, it, expect, vi, afterEach } from 'vitest'
import { eventEmitter } from '@/eventBus'

describe('eventEmitter.emit', () => {
  afterEach(() => {
    eventEmitter.removeAllListeners('test:throwing-listener')
    vi.restoreAllMocks()
  })

  it('keeps calling listeners and does not throw when one listener throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()
    eventEmitter.on('test:throwing-listener', () => {
      throw new Error('listener bug')
    })
    eventEmitter.on('test:throwing-listener', after)

    expect(() => eventEmitter.emit('test:throwing-listener', 1)).not.toThrow()
    expect(after).toHaveBeenCalledWith(1)
    expect(consoleError).toHaveBeenCalledWith(
      '[seed] listener for "test:throwing-listener" threw:',
      expect.objectContaining({ message: 'listener bug' }),
    )
  })
})
