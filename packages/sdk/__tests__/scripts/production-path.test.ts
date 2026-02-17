import { describe, it, expect } from 'vitest'
import { PathResolver } from '@/node/PathResolver'

describe('Production Path Resolution', () => {
  it('should resolve SDK root directory correctly', () => {
    const pathResolver = PathResolver.getInstance()
    const sdkRootDir = pathResolver.getSdkRootDir()
    
    console.log('SDK Root Dir:', sdkRootDir)
    console.log('Seed Schema Path:', sdkRootDir + '/seedSchema')
    
    // Verify the SDK root directory is resolved
    expect(sdkRootDir).toBeDefined()
    expect(typeof sdkRootDir).toBe('string')
    expect(sdkRootDir.length).toBeGreaterThan(0)
    
    // Verify the seed schema path can be constructed
    const seedSchemaPath = sdkRootDir + '/seedSchema'
    expect(seedSchemaPath).toContain('seedSchema')
  })

  it('should handle different environments correctly', () => {
    const pathResolver = PathResolver.getInstance()
    const sdkRootDir = pathResolver.getSdkRootDir()
    
    // In test environment, it should point to the src directory
    if (process.env.NODE_ENV === 'test') {
      expect(sdkRootDir).toContain('src')
    }
    
    // The path should always be a valid directory path
    expect(sdkRootDir).toMatch(/^[\/\\]/) // Should start with path separator
  })
}) 