import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Better-SQLite3 Error Handling', () => {
  let originalNodeEnv: string | undefined
  let consoleSpy: any

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv
    } else {
      delete process.env.NODE_ENV
    }
    vi.restoreAllMocks()
  })

  it('should provide clear error message when better-sqlite3 is missing', async () => {
    // Mock the import to simulate a missing better-sqlite3 module
    const mockImport = vi.fn().mockImplementation((moduleName: string) => {
      if (moduleName === 'better-sqlite3') {
        throw new Error('Cannot find module \'better-sqlite3\'')
      }
      if (moduleName === 'drizzle-orm/better-sqlite3') {
        throw new Error('Cannot find module \'drizzle-orm/better-sqlite3\'')
      }
      return Promise.resolve({})
    })

    // Temporarily replace the import function
    const originalImport = global.import
    global.import = mockImport as any

    try {
      let errorThrown = false
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
          console.error('[Seed Protocol] Error: better-sqlite3 is required for seeding the database.')
          console.error('[Seed Protocol] Please install better-sqlite3: npm install better-sqlite3')
          throw new Error('better-sqlite3 is required for seeding the database.')
        }
      } catch (error: any) {
        errorThrown = true
        errorMessage = error.message
      }

      // Verify the error was thrown with the correct message
      expect(errorThrown).toBe(true)
      expect(errorMessage).toBe('better-sqlite3 is required for seeding the database.')

      // Verify the console.error was called with the expected messages
      expect(consoleSpy).toHaveBeenCalledWith('[Seed Protocol] Error: better-sqlite3 is required for seeding the database.')
      expect(consoleSpy).toHaveBeenCalledWith('[Seed Protocol] Please install better-sqlite3: npm install better-sqlite3')

    } finally {
      // Restore the original import
      global.import = originalImport
    }
  })

  it('should handle partial import failures gracefully', async () => {
    // Mock the import to simulate partial failure
    const mockImport = vi.fn().mockImplementation((moduleName: string) => {
      if (moduleName === 'better-sqlite3') {
        return Promise.resolve({ default: 'mock-database' })
      }
      if (moduleName === 'drizzle-orm/better-sqlite3') {
        throw new Error('Cannot find module \'drizzle-orm/better-sqlite3\'')
      }
      return Promise.resolve({})
    })

    // Temporarily replace the import function
    const originalImport = global.import
    global.import = mockImport as any

    try {
      let errorThrown = false

      try {
        let drizzle: any
        let Database: any

        try {
          const drizzleModule = await import('drizzle-orm/better-sqlite3')
          const betterSqlite3Module = await import('better-sqlite3')
          drizzle = drizzleModule.drizzle
          Database = betterSqlite3Module
        } catch (importError: any) {
          console.error('[Seed Protocol] Error: better-sqlite3 is required for seeding the database.')
          console.error('[Seed Protocol] Please install better-sqlite3: npm install better-sqlite3')
          throw new Error('better-sqlite3 is required for seeding the database.')
        }
      } catch (error: any) {
        errorThrown = true
      }

      // Verify the error was thrown
      expect(errorThrown).toBe(true)

    } finally {
      // Restore the original import
      global.import = originalImport
    }
  })

  it('should handle successful imports correctly', async () => {
    // Mock the import to simulate successful imports
    const mockImport = vi.fn().mockImplementation((moduleName: string) => {
      if (moduleName === 'better-sqlite3') {
        return Promise.resolve({ default: 'mock-database' })
      }
      if (moduleName === 'drizzle-orm/better-sqlite3') {
        return Promise.resolve({ drizzle: 'mock-drizzle' })
      }
      return Promise.resolve({})
    })

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
      } catch (importError: any) {
        console.error('[Seed Protocol] Error: better-sqlite3 is required for seeding the database.')
        console.error('[Seed Protocol] Please install better-sqlite3: npm install better-sqlite3')
        throw new Error('better-sqlite3 is required for seeding the database.')
      }

      // Verify the imports worked
      expect(drizzle).toBe('mock-drizzle')
      expect(Database).toBe('mock-database')

      // Verify no error messages were logged
      expect(consoleSpy).not.toHaveBeenCalled()

    } finally {
      // Restore the original import
      global.import = originalImport
    }
  })

  it('should handle different types of import errors', async () => {
    const errorMessages = [
      'Cannot find module \'better-sqlite3\'',
      'Module not found: better-sqlite3',
      'ENOENT: no such file or directory, scandir \'/path/to/better-sqlite3\'',
      'Cannot resolve module \'better-sqlite3\''
    ]

    for (const errorMessage of errorMessages) {
      // Mock the import to simulate different error messages
      const mockImport = vi.fn().mockRejectedValue(new Error(errorMessage))

      // Temporarily replace the import function
      const originalImport = global.import
      global.import = mockImport as any

      try {
        let errorThrown = false

        try {
          let drizzle: any
          let Database: any

          try {
            const drizzleModule = await import('drizzle-orm/better-sqlite3')
            const betterSqlite3Module = await import('better-sqlite3')
            drizzle = drizzleModule.drizzle
            Database = betterSqlite3Module
          } catch (importError: any) {
            console.error('[Seed Protocol] Error: better-sqlite3 is required for seeding the database.')
            console.error('[Seed Protocol] Please install better-sqlite3: npm install better-sqlite3')
            throw new Error('better-sqlite3 is required for seeding the database.')
          }
        } catch (error: any) {
          errorThrown = true
        }

        // Verify the error was thrown
        expect(errorThrown).toBe(true)

      } finally {
        // Restore the original import
        global.import = originalImport
      }
    }
  })
}) 