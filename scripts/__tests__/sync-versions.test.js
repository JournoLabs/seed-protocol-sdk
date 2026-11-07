import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AWAITING_FIRST_PUBLISH, PUBLISH_ORDER } from '../release-channel.js'
import { SYNC_PACKAGES } from '../sync-versions.js'

describe('SYNC_PACKAGES', () => {
  it('bumps every package a release publishes or will publish', () => {
    const missing = [...PUBLISH_ORDER, ...AWAITING_FIRST_PUBLISH].filter((name) => !SYNC_PACKAGES.includes(name))
    assert.deepEqual(missing, [])
  })
})
