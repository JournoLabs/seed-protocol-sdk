import { FileManager } from '@/node/helpers/FileManager'
import { describe, it } from 'vitest'

describe('FileManager in node', () => {

  it('initialize for NodeJS', () => {
    FileManager.initializeFileSystem()
  })
})
