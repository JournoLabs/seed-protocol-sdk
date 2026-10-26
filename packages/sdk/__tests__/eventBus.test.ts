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

/** Emitting a request event the SDK no longer handles warns once (batch 12). */
describe('removed request events', () => {
  it('warns once when syncDbWithEas is emitted with no listener', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(eventEmitter.emit('syncDbWithEas')).toBe(false)
      eventEmitter.emit('syncDbWithEas')
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('client.syncFromEas()'))
    } finally {
      warn.mockRestore()
    }
  })

  it('stays quiet for other events with no listener', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      eventEmitter.emit('some.app.event')
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
