import { describe, it, expect, beforeEach, } from 'vitest'
import { execSync, }                   from 'child_process';
import { runInit, runSeed } from '@/test/__fixtures__/scripts'
import { INIT_SCRIPT_SUCCESS_MESSAGE }       from '@/helpers/constants'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { appState, models, seeds } from '@/seedSchema'
import * as schema from '@/seedSchema'
import { commandExists } from '@/helpers/scripts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('bin.ts', () => {
  const testDataPath = path.join(__dirname, '..', '__fixtures__', 'seedData.json')
  
  beforeEach(async () => {
    console.log('Running init script')

    execSync(`rm -rf ./__tests__/__mocks__/node/project/.seed`, {stdio: 'inherit'})
    execSync(`rm -rf ./__tests__/__mocks__/browser/project/.seed`, {stdio: 'inherit'})

    execSync(`rm -rf ./__tests__/__mocks__/node/project/seed-files`, {stdio: 'inherit'})
    execSync(`rm -rf ./__tests__/__mocks__/browser/project/seed-files`, {stdio: 'inherit'})

    const tsxExists = commandExists('tsx')

    if (!tsxExists) {
      execSync(`npm install -g tsx`, {stdio: 'inherit'})
    }
  })

  describe('init command', () => {
    it.each([
      {projectType: 'node', args: []},
      {projectType: 'node', args: ['./__tests__/__mocks__/node/project']},
      {projectType: 'node', args: ['./__tests__/__mocks__/node/project', './__tests__/__mocks__/node/project/seed-files']},
      {projectType: 'browser', args: []},
      {projectType: 'browser', args: ['./__tests__/__mocks__/browser/project']},
      {projectType: 'browser', args: ['./__tests__/__mocks__/browser/project', './__tests__/__mocks__/browser/project/seed-files']},
    ])('it should run the init command without errors', async ( {projectType, args}) => {
      const originalCwd = process.cwd()
      const originalNodeEnv = process.env.NODE_ENV
      process.env.NODE_ENV = ''
      process.env.SEED_SDK_TEST_PROJECT_TYPE = projectType
      if (!args || args.length === 0) {
        const defaultProjectDir = path.join(originalCwd, '__tests__', '__mocks__', projectType, 'project')
        process.chdir(defaultProjectDir)
      }
      const output = await runInit({projectType, args,})
      expect(output).toContain(INIT_SCRIPT_SUCCESS_MESSAGE)
      process.chdir(originalCwd)
      process.env.NODE_ENV = originalNodeEnv
    }, 120000);

    describe('schema file copying behavior', () => {
      it('should copy schema files from src/seedSchema to .seed/schema', async () => {
        const originalCwd = process.cwd()
        const projectDir = path.join(originalCwd, '__tests__', '__mocks__', 'node', 'project')
        
        try {
          // Clean up any existing .seed directory
          const dotSeedDir = path.join(projectDir, '.seed')
          if (fs.existsSync(dotSeedDir)) {
            fs.rmSync(dotSeedDir, { recursive: true, force: true })
          }
          
          await runInit({projectType: 'node', args: [projectDir]})
          
          // Check that .seed/schema directory exists
          const schemaDir = path.join(projectDir, '.seed', 'schema')
          expect(fs.existsSync(schemaDir)).toBe(true)
          
          // Get the list of files in the source directory
          const sourceSchemaDir = path.join(originalCwd, 'src', 'seedSchema')
          const sourceFiles = fs.readdirSync(sourceSchemaDir).filter(file => file.endsWith('.ts'))
          
          // Get the list of files in the target directory
          const targetFiles = fs.readdirSync(schemaDir).filter(file => file.endsWith('.ts'))
          
          // Should have copied all the source files
          expect(targetFiles.length).toBeGreaterThan(0)
          expect(targetFiles).toEqual(expect.arrayContaining(sourceFiles))
          
          // Verify that the files are exact copies (not generated)
          for (const file of sourceFiles) {
            const sourcePath = path.join(sourceSchemaDir, file)
            const targetPath = path.join(schemaDir, file)
            
            expect(fs.existsSync(targetPath)).toBe(true)
            
            const sourceContent = fs.readFileSync(sourcePath, 'utf-8')
            const targetContent = fs.readFileSync(targetPath, 'utf-8')
            
            // Files should be identical (not generated)
            expect(targetContent).toBe(sourceContent)
          }
          
        } finally {
          // Clean up
          const dotSeedDir = path.join(projectDir, '.seed')
          if (fs.existsSync(dotSeedDir)) {
            fs.rmSync(dotSeedDir, { recursive: true, force: true })
          }
        }
      }, 120000)

      it('should not generate additional schema files', async () => {
        const originalCwd = process.cwd()
        const projectDir = path.join(originalCwd, '__tests__', '__mocks__', 'node', 'project')
        
        try {
          // Clean up any existing .seed directory
          const dotSeedDir = path.join(projectDir, '.seed')
          if (fs.existsSync(dotSeedDir)) {
            fs.rmSync(dotSeedDir, { recursive: true, force: true })
          }
          
          await runInit({projectType: 'node', args: [projectDir]})
          
          const schemaDir = path.join(projectDir, '.seed', 'schema')
          const targetFiles = fs.readdirSync(schemaDir).filter(file => file.endsWith('.ts'))
          
          // Should not have generated files that weren't in the source
          const sourceSchemaDir = path.join(originalCwd, 'src', 'seedSchema')
          const sourceFiles = fs.readdirSync(sourceSchemaDir).filter(file => file.endsWith('.ts'))
          
          // All target files should have corresponding source files
          for (const targetFile of targetFiles) {
            expect(sourceFiles).toContain(targetFile)
          }
          
        } finally {
          // Clean up
          const dotSeedDir = path.join(projectDir, '.seed')
          if (fs.existsSync(dotSeedDir)) {
            fs.rmSync(dotSeedDir, { recursive: true, force: true })
          }
        }
      }, 120000)

      it('should not create index.ts file in schema directory', async () => {
        const originalCwd = process.cwd()
        const projectDir = path.join(originalCwd, '__tests__', '__mocks__', 'node', 'project')
        
        try {
          // Clean up any existing .seed directory
          const dotSeedDir = path.join(projectDir, '.seed')
          if (fs.existsSync(dotSeedDir)) {
            fs.rmSync(dotSeedDir, { recursive: true, force: true })
          }
          
          await runInit({projectType: 'node', args: [projectDir]})
          
          const schemaDir = path.join(projectDir, '.seed', 'schema')
          const files = fs.readdirSync(schemaDir)
          
          // Should not have an index.ts file (it should only copy the source index.ts if it exists)
          const sourceSchemaDir = path.join(originalCwd, 'src', 'seedSchema')
          const sourceIndexExists = fs.existsSync(path.join(sourceSchemaDir, 'index.ts'))
          
          if (sourceIndexExists) {
            // If source has index.ts, target should have it as a copy
            expect(files).toContain('index.ts')
          } else {
            // If source doesn't have index.ts, target shouldn't have it
            expect(files).not.toContain('index.ts')
          }
          
        } finally {
          // Clean up
          const dotSeedDir = path.join(projectDir, '.seed')
          if (fs.existsSync(dotSeedDir)) {
            fs.rmSync(dotSeedDir, { recursive: true, force: true })
          }
        }
      }, 120000)

      it('should not create .js, .d.ts, or .map files', async () => {
        const originalCwd = process.cwd()
        const projectDir = path.join(originalCwd, '__tests__', '__mocks__', 'node', 'project')
        
        try {
          // Clean up any existing .seed directory
          const dotSeedDir = path.join(projectDir, '.seed')
          if (fs.existsSync(dotSeedDir)) {
            fs.rmSync(dotSeedDir, { recursive: true, force: true })
          }
          
          await runInit({projectType: 'node', args: [projectDir]})
          
          const schemaDir = path.join(projectDir, '.seed', 'schema')
          const files = fs.readdirSync(schemaDir)
          
          // Should not have any compiled or generated files
          const compiledFiles = files.filter(file => 
            file.endsWith('.js') || 
            file.endsWith('.d.ts') || 
            file.endsWith('.map')
          )
          
          expect(compiledFiles).toHaveLength(0)
          
        } finally {
          // Clean up
          const dotSeedDir = path.join(projectDir, '.seed')
          if (fs.existsSync(dotSeedDir)) {
            fs.rmSync(dotSeedDir, { recursive: true, force: true })
          }
        }
      }, 120000)
    })

    describe('failure modes', () => {
      it('should handle missing src/seedSchema directory gracefully', async () => {
        const originalCwd = process.cwd()
        const projectDir = path.join(originalCwd, '__tests__', '__mocks__', 'node', 'project')
        process.chdir(projectDir)
        
        // Temporarily rename the source schema directory
        const sourceSchemaDir = path.join(originalCwd, 'src', 'seedSchema')
        const tempSchemaDir = path.join(originalCwd, 'src', 'seedSchema_temp')
        
        try {
          fs.renameSync(sourceSchemaDir, tempSchemaDir)
          
          // Should fail gracefully with a clear error message
          await expect(runInit({projectType: 'node', args: []})).rejects.toThrow()
          
        } finally {
          // Restore the directory
          if (fs.existsSync(tempSchemaDir)) {
            fs.renameSync(tempSchemaDir, sourceSchemaDir)
          }
          process.chdir(originalCwd)
        }
      }, 120000)

      it('should handle missing source schema directory gracefully', async () => {
        const originalCwd = process.cwd()
        const projectDir = path.join(originalCwd, '__tests__', '__mocks__', 'node', 'project')
        
        // Temporarily rename the source schema directory
        const sourceSchemaDir = path.join(originalCwd, 'src', 'seedSchema')
        const tempSchemaDir = path.join(originalCwd, 'src', 'seedSchema_temp')
        
        try {
          fs.renameSync(sourceSchemaDir, tempSchemaDir)
          
          // Should fail gracefully with a clear error message
          await expect(runInit({projectType: 'node', args: [projectDir]})).rejects.toThrow()
          
        } finally {
          // Restore the directory
          if (fs.existsSync(tempSchemaDir)) {
            fs.renameSync(tempSchemaDir, sourceSchemaDir)
          }
        }
      }, 120000)

      it('should handle corrupted source schema files', async () => {
        const originalCwd = process.cwd()
        const projectDir = path.join(originalCwd, '__tests__', '__mocks__', 'node', 'project')
        
        // Temporarily corrupt a source schema file
        const sourceSchemaDir = path.join(originalCwd, 'src', 'seedSchema')
        const testFile = path.join(sourceSchemaDir, 'AppStateSchema.ts')
        const originalContent = fs.readFileSync(testFile, 'utf-8')
        
        try {
          // Write invalid content to the source file
          fs.writeFileSync(testFile, 'invalid typescript content {')
          
          // Should still copy the file (copying doesn't validate content)
          await runInit({projectType: 'node', args: [projectDir]})
          
          const targetFile = path.join(projectDir, '.seed', 'schema', 'AppStateSchema.ts')
          expect(fs.existsSync(targetFile)).toBe(true)
          
          const targetContent = fs.readFileSync(targetFile, 'utf-8')
          expect(targetContent).toBe('invalid typescript content {')
          
        } finally {
          // Restore the original content
          fs.writeFileSync(testFile, originalContent)
          
          // Clean up
          const dotSeedDir = path.join(projectDir, '.seed')
          if (fs.existsSync(dotSeedDir)) {
            fs.rmSync(dotSeedDir, { recursive: true, force: true })
          }
        }
      }, 120000)
    })
  });

  describe('seed command', () => {
    beforeEach(async () => {
      // Clean up any existing .seed directory
      const projectDir = path.join(process.cwd(), '__tests__', '__mocks__', 'node', 'project')
      const dotSeedDir = path.join(projectDir, '.seed')
      if (fs.existsSync(dotSeedDir)) {
        fs.rmSync(dotSeedDir, { recursive: true, force: true })
      }
      
      // Initialize the database first
      await runInit({
        projectType: 'node', 
        args: [projectDir]
      })
    })

    it('should seed the database with test data', async ({expect}) => {
      // Run the seed command
      const output = await runSeed(testDataPath)
      expect(output).toContain('[Seed Protocol] Successfully seeded database')

      // Verify the seeded data
      const dbPath = './__tests__/__mocks__/node/project/.seed/db/app_db.sqlite3'
      const sqlite = new Database(dbPath)
      const db = drizzle(sqlite, { schema })

      // Check appState table
      const appStateRows = await db.select().from(appState)
      expect(appStateRows).toHaveLength(1)
      expect(appStateRows[0].key).toBe('test_key')
      expect(appStateRows[0].value).toBe('test_value')

      // Check models table
      const modelRows = await db.select().from(models)
      expect(modelRows).toHaveLength(1)
      expect(modelRows[0].name).toBe('TestModel')

      // Check seeds table
      const seedRows = await db.select().from(seeds)
      expect(seedRows).toHaveLength(1)
      expect(seedRows[0].type).toBe('test_type')

      sqlite.close()
    })

    it('should handle missing seed data file gracefully', async () => {
      const nonExistentPath = './non-existent-seed-data.json'
      await expect(runSeed(nonExistentPath)).rejects.toThrow()
    })

    it('should handle invalid JSON in seed data file', async () => {
      const invalidJsonPath = path.join(__dirname, '..', '__fixtures__', 'invalid-seed-data.json')
      fs.writeFileSync(invalidJsonPath, 'invalid json content')
      
      await expect(runSeed(invalidJsonPath)).rejects.toThrow()
      
      fs.unlinkSync(invalidJsonPath)
    })
  })
});
