import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import { PathResolver } from '@/node/PathResolver'

describe('PathResolver - Production Environment', () => {
  let originalCwd: string
  let testProjectDir: string
  let mockSdkDir: string

  beforeEach(async () => {
    originalCwd = process.cwd()
    
    // Create a mock production-like environment
    testProjectDir = path.join(process.cwd(), '__tests__', '__mocks__', 'production-test')
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

  it('should resolve SDK root directory correctly in production environment', () => {
    const pathResolver = PathResolver.getInstance()
    const sdkRootDir = pathResolver.getSdkRootDir()
    
    // Should point to the dist directory in the installed package
    const expectedPath = path.join(testProjectDir, 'node_modules', '@seedprotocol', 'sdk', 'dist')
    expect(sdkRootDir).toBe(expectedPath)
  })

  it('should find seedSchema directory in production environment', () => {
    const pathResolver = PathResolver.getInstance()
    const sdkRootDir = pathResolver.getSdkRootDir()
    const seedSchemaPath = path.join(sdkRootDir, 'seedSchema')
    
    // The seedSchema directory should exist in the dist folder
    expect(fs.existsSync(seedSchemaPath)).toBe(true)
    
    // Should contain the expected schema files
    const files = fs.readdirSync(seedSchemaPath)
    expect(files).toContain('AppStateSchema.ts')
    expect(files).toContain('ConfigSchema.ts')
    expect(files).toContain('index.ts')
  })

  it('should resolve app paths correctly in production environment', () => {
    const pathResolver = PathResolver.getInstance()
    const appPaths = pathResolver.getAppPaths(process.cwd())
    
    // Should resolve drizzle kit path correctly
    expect(appPaths.drizzleKitPath).toContain('drizzle-kit/bin.cjs')
    
    // Should resolve SDK root dir correctly
    expect(appPaths.sdkRootDir).toContain('dist')
  })

  it('should handle missing seedSchema directory gracefully', () => {
    // Remove the seedSchema directory to simulate a broken installation
    const seedSchemaPath = path.join(mockSdkDir, 'dist', 'seedSchema')
    if (fs.existsSync(seedSchemaPath)) {
      fs.rmSync(seedSchemaPath, { recursive: true, force: true })
    }
    
    const pathResolver = PathResolver.getInstance()
    const sdkRootDir = pathResolver.getSdkRootDir()
    const seedSchemaPath2 = path.join(sdkRootDir, 'seedSchema')
    
    // Should not exist
    expect(fs.existsSync(seedSchemaPath2)).toBe(false)
  })
}) 