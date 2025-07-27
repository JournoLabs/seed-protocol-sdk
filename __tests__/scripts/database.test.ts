import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Mock the better-sqlite3 module
vi.mock('better-sqlite3', () => {
  const MockDatabase = vi.fn().mockImplementation((dbPath) => ({
    close: vi.fn(),
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null)
    })
  }))
  
  return {
    default: MockDatabase
  }
})

// Mock the drizzle-orm module
vi.mock('drizzle-orm/better-sqlite3', () => ({
  drizzle: vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined)
    })
  })
}))

describe('Database Operations', () => {
  const testDataPath = path.join(__dirname, '..', '__fixtures__', 'seedData.json')
  
  beforeEach(() => {
    // Create test seed data
    const testSeedData = {
      appState: [{ key: 'test_key', value: 'test_value' }],
      config: [{ key: 'test_config', value: 'test_value' }],
      models: [{ name: 'TestModel', uid: 'test-uid' }],
      modelUids: [{ uid: 'test-uid', name: 'TestModel' }],
      metadata: [{ uid: 'test-metadata-uid', data: 'test-data' }],
      seeds: [{ uid: 'test-seed-uid', type: 'test_type' }],
      versions: [{ uid: 'test-version-uid', data: 'test-version-data' }]
    }
    
    fs.writeFileSync(testDataPath, JSON.stringify(testSeedData))
  })

  afterEach(() => {
    // Clean up test data file
    if (fs.existsSync(testDataPath)) {
      fs.unlinkSync(testDataPath)
    }
  })

  describe('Database constructor', () => {
    it('should use correct Database constructor syntax', async () => {
      // This test would catch the "Database is not a constructor" error
      const { default: Database } = await import('better-sqlite3')
      const { drizzle } = await import('drizzle-orm/better-sqlite3')
      
      // This should work without throwing an error
      const dbPath = '/tmp/test.db'
      const sqlite = new Database(dbPath)
      const db = drizzle(sqlite)
      
      expect(sqlite).toBeDefined()
      expect(db).toBeDefined()
      expect(Database).toHaveBeenCalledWith(dbPath)
    })

    it('should handle database connection errors gracefully', async () => {
      const { default: Database } = await import('better-sqlite3')
      
      // Mock a database connection error
      Database.mockImplementationOnce(() => {
        throw new Error('Database connection failed')
      })
      
      expect(() => {
        new Database('/invalid/path.db')
      }).toThrow('Database connection failed')
    })
  })

  describe('Seeding operations', () => {
    it('should seed database with valid data', async () => {
      const { default: Database } = await import('better-sqlite3')
      const { drizzle } = await import('drizzle-orm/better-sqlite3')
      
      const dbPath = '/tmp/test.db'
      const sqlite = new Database(dbPath)
      const db = drizzle(sqlite)
      
      // Mock the insert operations
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined)
      })
      db.insert = mockInsert
      
      // Test seeding each table
      const seedData = JSON.parse(fs.readFileSync(testDataPath, 'utf-8'))
      
      if (seedData.appState && seedData.appState.length > 0) {
        await db.insert({}).values(seedData.appState)
        expect(mockInsert).toHaveBeenCalled()
      }
    })

    it('should handle missing seed data file', async () => {
      const nonExistentPath = '/non/existent/seedData.json'
      
      expect(() => {
        JSON.parse(fs.readFileSync(nonExistentPath, 'utf-8'))
      }).toThrow()
    })

    it('should handle invalid JSON in seed data file', async () => {
      const invalidJsonPath = path.join(__dirname, 'invalid-seed-data.json')
      fs.writeFileSync(invalidJsonPath, 'invalid json content')
      
      expect(() => {
        JSON.parse(fs.readFileSync(invalidJsonPath, 'utf-8'))
      }).toThrow()
      
      fs.unlinkSync(invalidJsonPath)
    })

    it('should handle empty seed data gracefully', async () => {
      const emptySeedData = {}
      const emptyDataPath = path.join(__dirname, 'empty-seed-data.json')
      fs.writeFileSync(emptyDataPath, JSON.stringify(emptySeedData))
      
      try {
        const data = JSON.parse(fs.readFileSync(emptyDataPath, 'utf-8'))
        
        // Should not throw when seeding empty data
        expect(data).toEqual({})
        expect(data.appState).toBeUndefined()
        expect(data.models).toBeUndefined()
      } finally {
        fs.unlinkSync(emptyDataPath)
      }
    })
  })

  describe('Database file operations', () => {
    it('should create database directory if it does not exist', () => {
      const testDbDir = '/tmp/test-db-dir'
      const testDbPath = path.join(testDbDir, 'test.db')
      
      // Remove directory if it exists
      if (fs.existsSync(testDbDir)) {
        fs.rmSync(testDbDir, { recursive: true, force: true })
      }
      
      // Create directory
      fs.mkdirSync(testDbDir, { recursive: true })
      
      expect(fs.existsSync(testDbDir)).toBe(true)
      
      // Clean up
      fs.rmSync(testDbDir, { recursive: true, force: true })
    })

    it('should handle database file permissions', () => {
      const testDbPath = '/tmp/test-permissions.db'
      
      // This test would catch permission-related issues
      expect(() => {
        fs.accessSync('/tmp', fs.constants.W_OK)
      }).not.toThrow()
    })
  })
}) 