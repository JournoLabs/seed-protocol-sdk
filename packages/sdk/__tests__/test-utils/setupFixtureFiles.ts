/**
 * Unified fixture file setup for both Node.js and browser test environments
 * 
 * This module provides a single function that makes fixture files available
 * in the test environment, handling the differences between Node.js and browser:
 * 
 * - Browser: Reads fixture content from bundled fixtureFiles.ts and writes to OPFS
 * - Node.js: Copies fixture files from __tests__/__fixtures__ to project directory
 * 
 * @example
 * ```typescript
 * beforeAll(async () => {
 *   await setupTestEnvironment({ testFileUrl: import.meta.url })
 *   await setupFixtureFiles(['schema-with-ids.json', 'schema-without-ids.json'])
 * })
 * ```
 */

import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

/**
 * Makes fixture files available in the test environment
 * 
 * Browser: Writes files to OPFS using BaseFileManager
 * Node.js: Copies files from __tests__/__fixtures__ to project directory
 * 
 * @param fixtureNames - Array of fixture file names (e.g., ['schema-with-ids.json'])
 * @param targetDir - Optional target directory (defaults to project root or /app-files in browser)
 * @returns Promise that resolves when all files are available
 * 
 * @example
 * ```typescript
 * beforeAll(async () => {
 *   await setupFixtureFiles(['schema-with-ids.json', 'schema-without-ids.json'])
 * })
 * ```
 */
export async function setupFixtureFiles(
  fixtureNames: string[],
  targetDir?: string
): Promise<void> {
  const isNodeEnv = typeof window === 'undefined'
  
  if (isNodeEnv) {
    await setupFixtureFilesNode(fixtureNames, targetDir)
  } else {
    await setupFixtureFilesBrowser(fixtureNames, targetDir)
  }
}

/**
 * Node.js implementation: Copies fixture files from __fixtures__ to project directory
 */
async function setupFixtureFilesNode(
  fixtureNames: string[],
  targetDir?: string
): Promise<void> {
  const path = await import('path')
  const fs = await import('fs')
  const { fileURLToPath } = await import('url')
  
  // Get fixtures directory
  const testUtilsDir = path.dirname(fileURLToPath(import.meta.url))
  const fixturesDir = path.join(testUtilsDir, '..', '__fixtures__')
  
  // Determine target directory
  // If targetDir is provided, use it
  // Otherwise, use the current working directory (which should be __mocks__/node/project)
  const finalTargetDir = targetDir 
    ? path.resolve(targetDir)
    : process.cwd()
  
  // Ensure target directory exists
  if (!fs.existsSync(finalTargetDir)) {
    fs.mkdirSync(finalTargetDir, { recursive: true })
  }
  
  // Copy each fixture file
  for (const fixtureName of fixtureNames) {
    const sourcePath = path.join(fixturesDir, fixtureName)
    const targetPath = path.join(finalTargetDir, fixtureName)
    
    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        `Fixture file not found: ${fixtureName} at ${sourcePath}. ` +
        `Available fixtures: ${fs.readdirSync(fixturesDir).join(', ')}`
      )
    }
    
    // Copy file (overwrite if exists)
    fs.copyFileSync(sourcePath, targetPath)
    console.log(`[setupFixtureFiles] Copied ${fixtureName} to ${targetPath}`)
  }
}

/**
 * Clean up fixture files from the test project directory
 * Call this in afterAll hook to remove fixture files after tests
 */
export async function cleanupFixtureFiles(
  fixtureNames: string[],
  targetDir?: string
): Promise<void> {
  const isNodeEnv = typeof window === 'undefined'
  
  if (!isNodeEnv) {
    // Browser: No cleanup needed (OPFS is ephemeral)
    return
  }
  
  const path = await import('path')
  const fs = await import('fs')
  
  // Determine target directory (same logic as setupFixtureFilesNode)
  const finalTargetDir = targetDir 
    ? path.resolve(targetDir)
    : process.cwd()
  
  // Remove each fixture file
  for (const fixtureName of fixtureNames) {
    const targetPath = path.join(finalTargetDir, fixtureName)
    
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath)
      console.log(`[cleanupFixtureFiles] Removed ${fixtureName} from ${targetPath}`)
    }
  }
}

/**
 * Browser implementation: Reads from bundled fixtureFiles.ts and writes to OPFS
 */
async function setupFixtureFilesBrowser(
  fixtureNames: string[],
  targetDir?: string
): Promise<void> {
  // Dynamically import fixtureFiles (bundled module)
  const { fixtureFiles } = await import('./fixtureFiles')
  
  // Determine target directory
  // Default to /app-files (from config) or provided targetDir
  const finalTargetDir = targetDir || '/app-files'
  
  // Ensure target directory exists
  await BaseFileManager.createDirIfNotExists(finalTargetDir)
  
  // Write each fixture file to OPFS
  for (const fixtureName of fixtureNames) {
    const content = fixtureFiles[fixtureName]
    
    if (!content) {
      const availableFixtures = Object.keys(fixtureFiles).join(', ')
      throw new Error(
        `Fixture file not found: ${fixtureName}. ` +
        `Available fixtures: ${availableFixtures}`
      )
    }
    
    const targetPath = `${finalTargetDir}/${fixtureName}`
    await BaseFileManager.saveFile(targetPath, content)
    console.log(`[setupFixtureFiles] Wrote ${fixtureName} to ${targetPath}`)
  }
}

/**
 * Gets the path to a fixture file in the current environment
 * 
 * @param fixtureName - Name of the fixture file
 * @param baseDir - Optional base directory (defaults to project root or /app-files)
 * @returns Path to the fixture file
 * 
 * @example
 * ```typescript
 * const fixturePath = getFixturePath('schema-with-ids.json')
 * await loadSchemaFromFile(fixturePath)
 * ```
 */
export function getFixturePath(fixtureName: string, baseDir?: string): string {
  const isNodeEnv = typeof window === 'undefined'
  
  if (isNodeEnv) {
    // In Node.js, we need to dynamically import path
    // For now, return a path that can be resolved with path.join
    // The caller should use path.join if they have access to path module
    const nodeBaseDir = baseDir || process.cwd()
    return `${nodeBaseDir}/${fixtureName}`
  } else {
    // In browser, use OPFS path
    const browserBaseDir = baseDir || '/app-files'
    return `${browserBaseDir}/${fixtureName}`
  }
}

