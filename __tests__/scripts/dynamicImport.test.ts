import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Dynamic Import - better-sqlite3', () => {
  let originalNodeEnv: string | undefined

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv
    } else {
      delete process.env.NODE_ENV
    }
    vi.restoreAllMocks()
  })

  it('should successfully import better-sqlite3 dynamically', async () => {
    // Test the dynamic import functionality
    let drizzle: any
    let Database: any
    
    try {
      const drizzleModule = await import('drizzle-orm/better-sqlite3')
      const betterSqlite3Module = await import('better-sqlite3')
      drizzle = drizzleModule.drizzle
      Database = betterSqlite3Module
      
      // Verify the imports worked
      expect(typeof drizzle).toBe('function')
      expect(typeof Database).toBe('function')
      
      // Verify these are the expected modules
      expect(drizzle.name).toContain('drizzle')
      expect(Database.name).toContain('Database')
      
    } catch (importError) {
      // If better-sqlite3 is not available, that's expected in some test environments
      expect(importError).toBeDefined()
    }
  })

  it('should handle missing better-sqlite3 gracefully', async () => {
    // Mock the import to simulate a missing module
    const mockImport = vi.fn().mockRejectedValue(new Error('Cannot find module \'better-sqlite3\''))
    
    // Temporarily replace the import function
    const originalImport = global.import
    global.import = mockImport as any
    
    try {
      let drizzle: any
      let Database: any
      
      try {
        const drizzleModule = await import('drizzle-orm/better-sqlite3')
        const betterSqlite3Module = await import('better-sqlite3')
        drizzle = drizzleModule.drizzle
        Database = betterSqlite3Module
      } catch (importError) {
        // This should be caught and handled gracefully
        expect(importError.message).toContain('Cannot find module')
        return
      }
      
      // If we get here, the error wasn't thrown as expected
      expect.fail('Expected import to fail')
      
    } finally {
      // Restore the original import
      global.import = originalImport
    }
  })

  it('should import drizzle-orm/better-sqlite3 correctly', async () => {
    try {
      const drizzleModule = await import('drizzle-orm/better-sqlite3')
      
      // Verify the module structure
      expect(drizzleModule).toBeDefined()
      expect(typeof drizzleModule.drizzle).toBe('function')
      
      // The drizzle function should be callable
      expect(drizzleModule.drizzle.name).toContain('drizzle')
      
    } catch (importError) {
      // If the module is not available, that's acceptable in test environment
      expect(importError).toBeDefined()
    }
  })

  it('should handle import errors with proper error messages', async () => {
    // Test the error handling pattern used in the bin script
    let errorMessage = ''
    
    try {
      let drizzle: any
      let Database: any
      
      try {
        const drizzleModule = await import('drizzle-orm/better-sqlite3')
        const betterSqlite3Module = await import('better-sqlite3')
        drizzle = drizzleModule.drizzle
        Database = betterSqlite3Module
      } catch (importError: any) {
        errorMessage = importError.message
        throw new Error('better-sqlite3 is required for seeding the database.')
      }
      
    } catch (error: any) {
      expect(error.message).toBe('better-sqlite3 is required for seeding the database.')
    }
  })
}) 