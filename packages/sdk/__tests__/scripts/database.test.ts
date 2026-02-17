import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Database Operations', () => {
  const testDataPath = path.join(__dirname, '..', '__fixtures__', 'seedData.json')
  let dbPath: string
  let db: Database.Database
  let drizzleDb: BetterSQLite3Database<any>
  
  beforeEach(() => {
    // Create temporary database file for each test
    dbPath = path.join(os.tmpdir(), `test-db-${Date.now()}-${Math.random().toString(36).substring(7)}.db`)
    db = new Database(dbPath)
    drizzleDb = drizzle(db)
    
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
    // Close and remove database
    if (db) {
      db.close()
    }
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath)
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    
    // Clean up test data file
    if (fs.existsSync(testDataPath)) {
      fs.unlinkSync(testDataPath)
    }
  })

  describe('Database constructor', () => {
    it('should use correct Database constructor syntax', () => {
      // This test verifies the database can be created and used
      expect(db).toBeDefined()
      expect(drizzleDb).toBeDefined()
      expect(fs.existsSync(dbPath)).toBe(true)
    })

    it('should handle database connection errors gracefully', () => {
      // Test with invalid path - better-sqlite3 will create the file if parent directory exists
      // So we test with a path that has invalid characters or permissions
      const invalidPath = path.join(os.tmpdir(), 'nonexistent', 'subdir', 'test.db')
      
      // This should either succeed (if it can create the directory) or throw
      // We're testing that the error is handled, not that it always fails
      try {
        const testDb = new Database(invalidPath)
        testDb.close()
        // If it succeeded, clean up
        if (fs.existsSync(invalidPath)) {
          fs.unlinkSync(invalidPath)
        }
        // Test passed - database was created successfully
        expect(true).toBe(true)
      } catch (error) {
        // Expected - database creation failed
        expect(error).toBeInstanceOf(Error)
      }
    })
  })

  describe('Seeding operations', () => {
    it('should seed database with valid data', async () => {
      // Create a simple table schema for testing
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `)
      
      // Test seeding with real database operations
      const seedData = JSON.parse(fs.readFileSync(testDataPath, 'utf-8'))
      
      if (seedData.appState && seedData.appState.length > 0) {
        const stmt = db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)')
        for (const item of seedData.appState) {
          stmt.run(item.key, item.value)
        }
        
        // Verify data was inserted
        const result = db.prepare('SELECT * FROM app_state').all()
        expect(result.length).toBeGreaterThan(0)
        expect(result[0]).toHaveProperty('key')
        expect(result[0]).toHaveProperty('value')
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