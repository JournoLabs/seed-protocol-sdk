import { describe, expect, it } from 'vitest'
import { applySeedConfigDefaults } from '@/client/seedConfigDefaults'
import type { SeedConfig } from '@/types'

describe('applySeedConfigDefaults', () => {
  it('defaults endpoints from filesDir so client.init can omit them', () => {
    const config = { filesDir: '.seed' } as SeedConfig
    const normalized = applySeedConfigDefaults(config)
    expect(normalized?.endpoints).toEqual({ filePaths: '.seed', files: '.seed' })
  })

  it('fills only the missing endpoint field', () => {
    const config = {
      filesDir: '.seed',
      endpoints: { filePaths: '/files' },
    } as SeedConfig
    expect(applySeedConfigDefaults(config)?.endpoints).toEqual({
      filePaths: '/files',
      files: '.seed',
    })
  })

  it('defaults filesDir to .seed when the config sets neither filesDir nor endpoints', () => {
    const normalized = applySeedConfigDefaults({} as SeedConfig)
    expect(normalized?.filesDir).toBe('.seed')
    expect(normalized?.endpoints).toEqual({ filePaths: '.seed', files: '.seed' })
  })

  it('takes filesDir from endpoints.files when only that is set', () => {
    const normalized = applySeedConfigDefaults({ endpoints: { files: '/data' } } as SeedConfig)
    expect(normalized?.filesDir).toBe('/data')
    expect(normalized?.endpoints).toEqual({ filePaths: '/data', files: '/data' })
  })

  it('leaves a complete endpoints object unchanged', () => {
    const config = {
      filesDir: '.seed',
      endpoints: { filePaths: '/files', files: '/data' },
    } as SeedConfig
    expect(applySeedConfigDefaults(config)).toBe(config)
  })
})
