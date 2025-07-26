import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

describe('Bin Script - Production Environment', () => {
  let originalCwd: string
  let testProjectDir: string
  let mockSdkDir: string

  beforeEach(async () => {
    originalCwd = process.cwd()
    
    // Create a mock production-like environment
    testProjectDir = path.join(process.cwd(), '__tests__', '__mocks__', 'bin-production-test')
    mockSdkDir = path.join(testProjectDir, 'node_modules', '@seedprotocol', 'sdk')
    
    // Clean up any existing test directory
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true })
    }
    
    // Create the directory structure
    fs.mkdirSync(mockSdkDir, { recursive: true })
    
    // Copy the dist directory to simulate the installed package
    const distSource = path.join(process.cwd(), 'dist')
    if (fs.existsSync(distSource)) {
      fs.cpSync(distSource, path.join(mockSdkDir, 'dist'), { recursive: true })
    }
    
    // Create a mock package.json for the test project
    const packageJson = {
      name: 'test-project',
      version: '1.0.0',
      type: 'module',
      dependencies: {
        '@seedprotocol/sdk': '0.3.18'
      }
    }
    fs.writeFileSync(path.join(testProjectDir, 'package.json'), JSON.stringify(packageJson, null, 2))
    
    // Create a mock seed.config.ts file
    const seedConfig = `
export default {
  models: {},
  endpoints: {
    localOutputDir: './seed-files'
  }
}
`
    fs.writeFileSync(path.join(testProjectDir, 'seed.config.ts'), seedConfig)
    
    // Change to the test project directory
    process.chdir(testProjectDir)
  })

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd)
    
    // Clean up test directory
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true })
    }
  })

  it('should find seedSchema directory when running from production environment', () => {
    const sdkRootDir = path.join(mockSdkDir, 'dist')
    const seedSchemaPath = path.join(sdkRootDir, 'seedSchema')
    
    // Verify the seedSchema directory exists in the dist folder
    expect(fs.existsSync(seedSchemaPath)).toBe(true)
    
    // Verify it contains the expected files
    const files = fs.readdirSync(seedSchemaPath)
    expect(files).toContain('AppStateSchema.ts')
    expect(files).toContain('ConfigSchema.ts')
    expect(files).toContain('index.ts')
  })

  it('should copy seedSchema directory correctly', () => {
    const sdkRootDir = path.join(mockSdkDir, 'dist')
    const sourceSeedSchemaPath = path.join(sdkRootDir, 'seedSchema')
    const targetSeedSchemaPath = path.join(testProjectDir, '.seed', 'schema')
    
    // Create the target directory
    fs.mkdirSync(path.dirname(targetSeedSchemaPath), { recursive: true })
    
    // Copy the seedSchema directory (simulating what the bin script does)
    fs.cpSync(sourceSeedSchemaPath, targetSeedSchemaPath, { recursive: true })
    
    // Verify the copy worked
    expect(fs.existsSync(targetSeedSchemaPath)).toBe(true)
    
    // Verify the files were copied
    const files = fs.readdirSync(targetSeedSchemaPath)
    expect(files).toContain('AppStateSchema.ts')
    expect(files).toContain('ConfigSchema.ts')
    expect(files).toContain('index.ts')
  })

  it('should handle missing seedSchema directory gracefully', () => {
    // Remove the seedSchema directory to simulate a broken installation
    const seedSchemaPath = path.join(mockSdkDir, 'dist', 'seedSchema')
    if (fs.existsSync(seedSchemaPath)) {
      fs.rmSync(seedSchemaPath, { recursive: true, force: true })
    }
    
    // Verify it doesn't exist
    expect(fs.existsSync(seedSchemaPath)).toBe(false)
    
    // The bin script should handle this gracefully when it tries to copy
    const targetSeedSchemaPath = path.join(testProjectDir, '.seed', 'schema')
    
    // This should not throw an error, but the directory won't be created
    expect(() => {
      if (fs.existsSync(seedSchemaPath)) {
        fs.mkdirSync(path.dirname(targetSeedSchemaPath), { recursive: true })
        fs.cpSync(seedSchemaPath, targetSeedSchemaPath, { recursive: true })
      }
    }).not.toThrow()
  })

  it('should resolve paths correctly for production environment', () => {
    // Test the path resolution logic that the bin script uses
    const sdkRootDir = path.join(mockSdkDir, 'dist')
    
    // These paths should exist in the production environment
    const drizzleConfigPath = path.join(sdkRootDir, 'node', 'db', 'NODE_APP_DB_CONFIG')
    const drizzleKitPath = path.join(sdkRootDir, 'node', 'codegen')
    const templatesPath = path.join(drizzleKitPath, 'templates')
    
    // Verify the paths exist
    expect(fs.existsSync(drizzleConfigPath)).toBe(true)
    expect(fs.existsSync(drizzleKitPath)).toBe(true)
    expect(fs.existsSync(templatesPath)).toBe(true)
  })

  it('should handle the case where dist directory is missing', () => {
    // Remove the dist directory to simulate a broken installation
    const distPath = path.join(mockSdkDir, 'dist')
    if (fs.existsSync(distPath)) {
      fs.rmSync(distPath, { recursive: true, force: true })
    }
    
    // Verify it doesn't exist
    expect(fs.existsSync(distPath)).toBe(false)
    
    // The path resolution should still work, but point to a non-existent location
    const sdkRootDir = path.join(mockSdkDir, 'dist')
    const seedSchemaPath = path.join(sdkRootDir, 'seedSchema')
    
    // This should not exist
    expect(fs.existsSync(seedSchemaPath)).toBe(false)
  })
}) 