import { FileManager } from '@/node/helpers/FileManager'
import { describe, it, expect } from 'vitest'

describe('FileManager in node', () => {

  it('initialize for NodeJS', () => {
    FileManager.initializeFileSystem()
  })
})

describe('NodeFileManager.getContentUrlFromPath', () => {
  it('returns a file:// URL instead of throwing', async () => {
    const url = await new FileManager().getContentUrlFromPath('/tmp/seed/html/abc.html')
    expect(url).toBe('file:///tmp/seed/html/abc.html')
  })
})
