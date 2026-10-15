import { describe, expect, it } from 'vitest'
import {
  hasPendingPropertyWrite,
  propertyWriteKey,
  reservePropertyWrite,
} from '@/helpers/propertyWriteQueue'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('propertyWriteQueue', () => {
  it('runs writes one at a time and skips one a newer save replaced', async () => {
    const key = propertyWriteKey('seed-queue-1', 'title')!
    const order: string[] = []
    const firstWrite = deferred()

    const firstStarted = deferred()
    const first = reservePropertyWrite(key)
    const firstRun = first.run(async () => {
      order.push('first start')
      firstStarted.resolve()
      await firstWrite.promise
      order.push('first end')
    })
    // Two more keystrokes while the first write is running.
    await firstStarted.promise
    const second = reservePropertyWrite(key)
    const third = reservePropertyWrite(key)
    const secondRun = second.run(async () => order.push('second'))
    const thirdRun = third.run(async () => order.push('third'))

    expect(hasPendingPropertyWrite(key)).toBe(true)
    firstWrite.resolve()

    expect((await firstRun).skipped).toBe(false)
    expect((await secondRun).skipped).toBe(true)
    expect((await thirdRun).skipped).toBe(false)
    expect(order).toEqual(['first start', 'first end', 'third'])
    expect(hasPendingPropertyWrite(key)).toBe(false)
  })

  it('reserves at save start: an older save that writes late is skipped', async () => {
    const key = propertyWriteKey('seed-queue-2', 'title')!
    const older = reservePropertyWrite(key)
    const newer = reservePropertyWrite(key)
    const written: string[] = []
    expect((await newer.run(async () => written.push('new'))).skipped).toBe(false)
    expect((await older.run(async () => written.push('old'))).skipped).toBe(true)
    expect(written).toEqual(['new'])
  })

  it('a released place stops counting as pending, and a failed write frees the queue', async () => {
    const key = propertyWriteKey('seed-queue-3', 'title')!
    const refused = reservePropertyWrite(key)
    expect(hasPendingPropertyWrite(key)).toBe(true)
    refused.release()
    refused.release()
    expect(hasPendingPropertyWrite(key)).toBe(false)

    const failing = reservePropertyWrite(key)
    await expect(failing.run(async () => Promise.reject(new Error('disk full')))).rejects.toThrow('disk full')
    const next = reservePropertyWrite(key)
    expect(await next.run(async () => 'ok')).toEqual({ skipped: false, result: 'ok' })
    expect(hasPendingPropertyWrite(key)).toBe(false)
  })
})
