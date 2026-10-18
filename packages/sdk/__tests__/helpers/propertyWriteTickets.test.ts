import { describe, it, expect } from 'vitest'
import { beginPropertyWrite, hasPendingPropertyWrite, propertyWriteKey } from '@/helpers/propertyWriteTickets'

describe('propertyWriteTickets', () => {
  it('only the newest save of a property is the latest, whatever order they finish in', () => {
    const key = propertyWriteKey('seed-order', 'title')!
    const older = beginPropertyWrite(key)
    const newer = beginPropertyWrite(key)
    expect(newer.isLatest()).toBe(true)
    expect(older.isLatest()).toBe(false)
    newer.end()
    // Ending the newer save doesn't make the older one the latest again
    expect(older.isLatest()).toBe(false)
    older.end()
  })

  it('properties have separate tickets', () => {
    const title = beginPropertyWrite(propertyWriteKey('seed-separate', 'title')!)
    const body = beginPropertyWrite(propertyWriteKey('seed-separate', 'body')!)
    expect(title.isLatest()).toBe(true)
    expect(body.isLatest()).toBe(true)
    title.end()
    body.end()
  })

  it('counts a save as pending until it ends, once', () => {
    const key = propertyWriteKey('seed-pending', 'title')!
    const first = beginPropertyWrite(key)
    const second = beginPropertyWrite(key)
    expect(hasPendingPropertyWrite(key)).toBe(true)
    first.end()
    first.end()
    expect(hasPendingPropertyWrite(key)).toBe(true)
    second.end()
    expect(hasPendingPropertyWrite(key)).toBe(false)
  })

  it('has no key without a seed id and a property name', () => {
    expect(propertyWriteKey(undefined, 'title')).toBeUndefined()
    expect(propertyWriteKey('seed', null)).toBeUndefined()
  })
})
