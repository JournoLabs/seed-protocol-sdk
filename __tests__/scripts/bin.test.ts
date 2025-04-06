import { describe, it, expect, beforeEach, } from 'vitest'
import { execSync, }                   from 'child_process';
import { runInit, runSeed } from '@/test/__fixtures__/scripts'
import { INIT_SCRIPT_SUCCESS_MESSAGE }       from '@/helpers/constants'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { appState } from '@/seedSchema/AppStateSchema'
import { models }  from '@/seedSchema/ModelSchema'
import { seeds }   from '@/seedSchema'
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
  });

  describe('seed command', () => {
    beforeEach(async () => {
      // Initialize the database first
      await runInit({
        projectType: 'node', 
        args: ['./__tests__/__mocks__/node/project']
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
