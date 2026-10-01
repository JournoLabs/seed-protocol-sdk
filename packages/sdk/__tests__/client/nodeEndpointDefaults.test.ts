import { describe, expect, it } from 'vitest'
import { normalizeSeedConfigEndpoints } from '@/client/nodeEndpointDefaults'
import type { SeedConfig } from '@/types'

describe('normalizeSeedConfigEndpoints', () => {
  it('defaults Node endpoints from filesDir so client.init can omit them', () => {
    const config = { filesDir: '.seed' } as SeedConfig
    const normalized = normalizeSeedConfigEndpoints(config)
    expect(normalized?.endpoints).toEqual({ filePaths: '.seed', files: '.seed' })
  })

  it('fills only the missing endpoint field', () => {
    const config = {
      filesDir: '.seed',
      endpoints: { filePaths: '/files' },
    } as SeedConfig
    expect(normalizeSeedConfigEndpoints(config)?.endpoints).toEqual({
      filePaths: '/files',
      files: '.seed',
    })
  })

  it('does not invent endpoints when filesDir is missing, so init still throws', () => {
    const config = {} as SeedConfig
    expect(normalizeSeedConfigEndpoints(config)?.endpoints).toBeUndefined()
  })

  it('leaves a complete endpoints object unchanged', () => {
    const config = {
      filesDir: '.seed',
      endpoints: { filePaths: '/files', files: '/data' },
    } as SeedConfig
    expect(normalizeSeedConfigEndpoints(config)).toBe(config)
  })
})
