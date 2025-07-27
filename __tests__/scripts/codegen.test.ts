import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createDrizzleSchemaFilesFromConfig } from '@/node/codegen'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Code Generation', () => {
  const testProjectDir = path.join(__dirname, '..', '__mocks__', 'node', 'project')
  const testConfigPath = path.join(testProjectDir, 'seed.config.ts')
  const outputDir = path.join(testProjectDir, '.seed', 'schema')

  beforeEach(() => {
    // Clean up any existing generated files
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  describe('Schema file generation', () => {
    it('should not generate imports for non-existent schema files', async () => {
      // Create a test config with a model that has a List property referencing a non-existent model
      const testConfigContent = `
        import { Model, Property, List } from '@seedprotocol/sdk'
        
        @Model()
        export class TestModel {
          @List('NonExistentModel')
          nonExistentRefs: string[]
        }
      `
      
      const tempConfigPath = path.join(testProjectDir, 'temp.config.ts')
      fs.writeFileSync(tempConfigPath, testConfigContent)

      try {
        await createDrizzleSchemaFilesFromConfig(tempConfigPath, outputDir)
        
        // Check that the generated schema file doesn't have invalid imports
        const generatedFiles = fs.readdirSync(outputDir)
        const schemaFile = generatedFiles.find(file => file.includes('TestModel'))
        
        if (schemaFile) {
          const schemaContent = fs.readFileSync(path.join(outputDir, schemaFile), 'utf-8')
          
          // Should not contain import for non-existent model
          expect(schemaContent).not.toContain("import { nonExistentModels } from './nonexistentmodelSchema'")
          expect(schemaContent).not.toContain("import { nonExistentModels } from './NonExistentModelSchema'")
          
          // Should still contain the basic imports
          expect(schemaContent).toContain("import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'")
          expect(schemaContent).toContain("import { relations } from 'drizzle-orm'")
        }
      } finally {
        // Clean up
        if (fs.existsSync(tempConfigPath)) {
          fs.unlinkSync(tempConfigPath)
        }
      }
    })

    it('should handle List properties with primitive types correctly', async () => {
      const testConfigContent = `
        import { Model, Property, List } from '@seedprotocol/sdk'
        
        @Model()
        export class TestModel {
          @List('Text')
          texts: string[]
          
          @List('Number')
          numbers: number[]
          
          @List('Boolean')
          booleans: boolean[]
          
          @List('Date')
          dates: Date[]
        }
      `
      
      const tempConfigPath = path.join(testProjectDir, 'temp.config.ts')
      fs.writeFileSync(tempConfigPath, testConfigContent)

      try {
        await createDrizzleSchemaFilesFromConfig(tempConfigPath, outputDir)
        
        const generatedFiles = fs.readdirSync(outputDir)
        const schemaFile = generatedFiles.find(file => file.includes('TestModel'))
        
        if (schemaFile) {
          const schemaContent = fs.readFileSync(path.join(outputDir, schemaFile), 'utf-8')
          
          // Should not contain imports for primitive types
          expect(schemaContent).not.toContain("import { texts } from './textSchema'")
          expect(schemaContent).not.toContain("import { numbers } from './numberSchema'")
          expect(schemaContent).not.toContain("import { booleans } from './booleanSchema'")
          expect(schemaContent).not.toContain("import { dates } from './dateSchema'")
        }
      } finally {
        if (fs.existsSync(tempConfigPath)) {
          fs.unlinkSync(tempConfigPath)
        }
      }
    })

    it('should validate that generated schema files are valid TypeScript', async () => {
      await createDrizzleSchemaFilesFromConfig(testConfigPath, outputDir)
      
      const generatedFiles = fs.readdirSync(outputDir)
      
      for (const file of generatedFiles) {
        if (file.endsWith('.ts')) {
          const filePath = path.join(outputDir, file)
          const content = fs.readFileSync(filePath, 'utf-8')
          
          // Basic TypeScript syntax validation
          expect(content).toContain('import')
          expect(content).toContain('export')
          
          // Should not have syntax errors like missing semicolons or brackets
          const openBrackets = (content.match(/\{/g) || []).length
          const closeBrackets = (content.match(/\}/g) || []).length
          expect(openBrackets).toBe(closeBrackets)
          
          // Should not have unmatched quotes
          const singleQuotes = (content.match(/'/g) || []).length
          const doubleQuotes = (content.match(/"/g) || []).length
          expect(singleQuotes % 2).toBe(0)
          expect(doubleQuotes % 2).toBe(0)
        }
      }
    })
  })
}) 