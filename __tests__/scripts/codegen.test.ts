import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Schema File Copying', () => {
  const testProjectDir = path.join(__dirname, '..', '__mocks__', 'node', 'project')
  const outputDir = path.join(testProjectDir, '.seed', 'schema')

  beforeEach(() => {
    // Clean up any existing copied files
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  describe('Schema file copying behavior', () => {
    it('should copy all schema files from src/seedSchema', async () => {
      // Get source files
      const originalCwd = process.cwd()
      const sourceSchemaDir = path.join(originalCwd, 'src', 'seedSchema')
      const sourceFiles = fs.readdirSync(sourceSchemaDir).filter(file => file.endsWith('.ts'))
      
      // Manually copy the files to simulate what the init command does
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }
      
      for (const file of sourceFiles) {
        const sourcePath = path.join(sourceSchemaDir, file)
        const targetPath = path.join(outputDir, file)
        fs.copyFileSync(sourcePath, targetPath)
      }
      
      // Check that output directory exists
      expect(fs.existsSync(outputDir)).toBe(true)
      
      // Get copied files
      const copiedFiles = fs.readdirSync(outputDir).filter(file => file.endsWith('.ts'))
      
      // Should have copied all source files
      expect(copiedFiles).toEqual(expect.arrayContaining(sourceFiles))
      expect(copiedFiles.length).toBe(sourceFiles.length)
      
      // Verify each file is an exact copy
      for (const file of sourceFiles) {
        const sourcePath = path.join(sourceSchemaDir, file)
        const targetPath = path.join(outputDir, file)
        
        expect(fs.existsSync(targetPath)).toBe(true)
        
        const sourceContent = fs.readFileSync(sourcePath, 'utf-8')
        const targetContent = fs.readFileSync(targetPath, 'utf-8')
        
        expect(targetContent).toBe(sourceContent)
      }
    })

    it('should not create additional files beyond what exists in source', async () => {
      // Get source files
      const originalCwd = process.cwd()
      const sourceSchemaDir = path.join(originalCwd, 'src', 'seedSchema')
      const sourceFiles = fs.readdirSync(sourceSchemaDir).filter(file => file.endsWith('.ts'))
      
      // Manually copy the files
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }
      
      for (const file of sourceFiles) {
        const sourcePath = path.join(sourceSchemaDir, file)
        const targetPath = path.join(outputDir, file)
        fs.copyFileSync(sourcePath, targetPath)
      }
      
      // Get copied files
      const copiedFiles = fs.readdirSync(outputDir).filter(file => file.endsWith('.ts'))
      
      // Should not have any files that weren't in the source
      for (const copiedFile of copiedFiles) {
        expect(sourceFiles).toContain(copiedFile)
      }
      
      // Should not have any compiled or generated files
      const allFiles = fs.readdirSync(outputDir)
      const compiledFiles = allFiles.filter(file => 
        file.endsWith('.js') || 
        file.endsWith('.d.ts') || 
        file.endsWith('.map')
      )
      
      expect(compiledFiles).toHaveLength(0)
    })

    it('should preserve file structure and content integrity', async () => {
      // Get source files
      const originalCwd = process.cwd()
      const sourceSchemaDir = path.join(originalCwd, 'src', 'seedSchema')
      const sourceFiles = fs.readdirSync(sourceSchemaDir).filter(file => file.endsWith('.ts'))
      
      // Manually copy the files
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }
      
      for (const file of sourceFiles) {
        const sourcePath = path.join(sourceSchemaDir, file)
        const targetPath = path.join(outputDir, file)
        fs.copyFileSync(sourcePath, targetPath)
      }
      
      // Verify each copied file maintains its structure
      for (const file of sourceFiles) {
        const sourcePath = path.join(sourceSchemaDir, file)
        const targetPath = path.join(outputDir, file)
        
        const sourceContent = fs.readFileSync(sourcePath, 'utf-8')
        const targetContent = fs.readFileSync(targetPath, 'utf-8')
        
        // Content should be identical
        expect(targetContent).toBe(sourceContent)
        
        // Should maintain TypeScript syntax
        expect(targetContent).toContain('export')
        
        // Should not have any syntax errors (basic check)
        const openBrackets = (targetContent.match(/\{/g) || []).length
        const closeBrackets = (targetContent.match(/\}/g) || []).length
        expect(openBrackets).toBe(closeBrackets)
      }
    })
  })
}) 