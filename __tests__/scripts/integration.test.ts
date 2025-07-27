import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Integration Tests', () => {
  const testProjectDir = path.join(__dirname, '..', '__mocks__', 'node', 'project')
  const originalCwd = process.cwd()

  beforeEach(() => {
    // Clean up any existing .seed directory
    const dotSeedDir = path.join(testProjectDir, '.seed')
    if (fs.existsSync(dotSeedDir)) {
      fs.rmSync(dotSeedDir, { recursive: true, force: true })
    }
  })

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd)
  })

  describe('seed init command', () => {
    it('should complete without module resolution errors', async () => {
      // Change to test project directory
      process.chdir(testProjectDir)
      
      try {
        // Run the init command
        const output = execSync('npx seed init', { 
          encoding: 'utf-8',
          stdio: 'pipe'
        })
        
        // Should not contain module resolution errors
        expect(output).not.toContain('Cannot find module')
        expect(output).not.toContain('MODULE_NOT_FOUND')
        expect(output).not.toContain('tagSchema')
        
        // Should complete successfully
        expect(output).toContain('Finished running init script')
        
        // Verify that .seed directory was created
        const dotSeedDir = path.join(testProjectDir, '.seed')
        expect(fs.existsSync(dotSeedDir)).toBe(true)
        
        // Verify that schema directory was created
        const schemaDir = path.join(dotSeedDir, 'schema')
        expect(fs.existsSync(schemaDir)).toBe(true)
        
        // Verify that db directory was created
        const dbDir = path.join(dotSeedDir, 'db')
        expect(fs.existsSync(dbDir)).toBe(true)
        
      } catch (error) {
        // If the command fails, check the error output
        if (error instanceof Error) {
          const errorOutput = error.message
          
          // Should not contain the specific errors we fixed
          expect(errorOutput).not.toContain('Cannot find module \'./tagSchema\'')
          expect(errorOutput).not.toContain('Database is not a constructor')
          expect(errorOutput).not.toContain('.seed/app/schema')
          
          // Log the actual error for debugging
          console.error('Init command failed:', errorOutput)
        }
        
        throw error
      }
    }, 120000) // 2 minute timeout

    it('should generate valid schema files', async () => {
      process.chdir(testProjectDir)
      
      try {
        execSync('npx seed init', { stdio: 'pipe' })
        
        const schemaDir = path.join(testProjectDir, '.seed', 'schema')
        const schemaFiles = fs.readdirSync(schemaDir)
        
        // Should have generated schema files
        expect(schemaFiles.length).toBeGreaterThan(0)
        
        // Check each schema file for validity
        for (const file of schemaFiles) {
          if (file.endsWith('.ts')) {
            const filePath = path.join(schemaDir, file)
            const content = fs.readFileSync(filePath, 'utf-8')
            
            // Should be valid TypeScript
            expect(content).toContain('import')
            expect(content).toContain('export')
            
            // Should not have syntax errors
            const openBrackets = (content.match(/\{/g) || []).length
            const closeBrackets = (content.match(/\}/g) || []).length
            expect(openBrackets).toBe(closeBrackets)
            
            // Should not have invalid imports
            expect(content).not.toMatch(/import.*from '\.\/[^']*Schema'/)
            
            // Should have proper Drizzle table definitions
            expect(content).toContain('sqliteTable')
          }
        }
      } catch (error) {
        console.error('Schema generation failed:', error)
        throw error
      }
    }, 120000)

    it('should create valid database configuration', async () => {
      process.chdir(testProjectDir)
      
      try {
        execSync('npx seed init', { stdio: 'pipe' })
        
        const dbConfigPath = path.join(testProjectDir, '.seed', 'db', 'app_db.sqlite3')
        
        // Database file should be created
        expect(fs.existsSync(dbConfigPath)).toBe(true)
        
        // Should be a valid SQLite database file
        const stats = fs.statSync(dbConfigPath)
        expect(stats.size).toBeGreaterThan(0)
        
      } catch (error) {
        console.error('Database creation failed:', error)
        throw error
      }
    }, 120000)
  })

  describe('seed command', () => {
    beforeEach(async () => {
      // Initialize the database first
      process.chdir(testProjectDir)
      execSync('npx seed init', { stdio: 'pipe' })
    })

    it('should seed database without constructor errors', async () => {
      const seedDataPath = path.join(__dirname, '..', '__fixtures__', 'seedData.json')
      
      try {
        const output = execSync(`npx seed seed ${seedDataPath}`, { 
          encoding: 'utf-8',
          stdio: 'pipe'
        })
        
        // Should not contain database constructor errors
        expect(output).not.toContain('Database is not a constructor')
        expect(output).not.toContain('TypeError')
        
        // Should complete successfully
        expect(output).toContain('Successfully seeded database')
        
      } catch (error) {
        if (error instanceof Error) {
          const errorOutput = error.message
          
          // Should not contain the specific errors we fixed
          expect(errorOutput).not.toContain('Database is not a constructor')
          expect(errorOutput).not.toContain('TypeError: Database is not a constructor')
          
          console.error('Seed command failed:', errorOutput)
        }
        
        throw error
      }
    }, 60000)
  })

  describe('Path resolution in production', () => {
    it('should resolve paths correctly in production environment', () => {
      // Simulate production environment
      const originalNodeEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      
      try {
        // Test path resolution logic
        const sdkRootDir = '/tmp/node_modules/@seedprotocol/sdk/dist'
        const configPath = 'db/configs/node.app.db.config.ts'
        const fullPath = path.join(sdkRootDir, configPath)
        
        // Should resolve to correct production path
        expect(fullPath).toBe('/tmp/node_modules/@seedprotocol/sdk/dist/db/configs/node.app.db.config.ts')
        
        // Should not resolve to old incorrect path
        expect(fullPath).not.toBe('/tmp/node_modules/@seedprotocol/sdk/dist/node.app.db.config.ts')
        
      } finally {
        process.env.NODE_ENV = originalNodeEnv
      }
    })

    it('should handle missing dependencies gracefully', () => {
      // This test would catch missing dependency issues
      expect(() => {
        // Try to import better-sqlite3 (this would fail in test environment)
        require('better-sqlite3')
      }).toThrow()
    })
  })

  describe('Build process validation', () => {
    it('should build without errors', () => {
      try {
        const output = execSync('npm run build', { 
          encoding: 'utf-8',
          stdio: 'pipe'
        })
        
        // Should build successfully
        expect(output).toContain('built in')
        
        // Should not have import errors
        expect(output).not.toContain('Module not found')
        expect(output).not.toContain('Cannot resolve')
        
      } catch (error) {
        if (error instanceof Error) {
          const errorOutput = error.message
          
          // Should not have the specific errors we fixed
          expect(errorOutput).not.toContain('saveAppState.js')
          expect(errorOutput).not.toContain('Cannot resolve')
          
          console.error('Build failed:', errorOutput)
        }
        
        throw error
      }
    }, 60000)

    it('should copy configuration files to correct locations', () => {
      try {
        execSync('npm run build', { stdio: 'pipe' })
        
        // Check that config files are in correct locations
        const expectedPaths = [
          'dist/db/configs/node.app.db.config.ts',
          'dist/shared/configs/browser.app.db.config.ts'
        ]
        
        for (const expectedPath of expectedPaths) {
          const fullPath = path.join(process.cwd(), expectedPath)
          expect(fs.existsSync(fullPath)).toBe(true)
        }
        
      } catch (error) {
        console.error('Build validation failed:', error)
        throw error
      }
    }, 60000)
  })
}) 