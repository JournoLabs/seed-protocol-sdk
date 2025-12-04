import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { drizzle } from 'drizzle-orm/libsql'
import { generateSQLiteDrizzleJson, generateSQLiteMigration, generateMigration, pushSQLiteSchema } from 'drizzle-kit/api'
import * as schema from '@/seedSchema'
import { createClient } from '@libsql/client'

// Get the directory of this file to resolve relative paths
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const commandExists = (command: string): boolean => {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Finds the seed binary path, trying multiple locations
 * @returns The path to the seed binary, or null if not found
 */
export const findSeedBinary = (): string | null => {
  const cwd = process.cwd()
  
  // Try common locations for the seed binary
  const possiblePaths = [
    path.join(cwd, 'node_modules', '.bin', 'seed'),
    path.join(cwd, 'node_modules', '@seedprotocol', 'cli', 'dist', 'bin.js'),
    // Try parent directories (for monorepos or nested projects)
    path.join(cwd, '..', 'node_modules', '.bin', 'seed'),
    path.join(cwd, '..', 'node_modules', '@seedprotocol', 'cli', 'dist', 'bin.js'),
    path.join(cwd, '..', '..', 'node_modules', '.bin', 'seed'),
    path.join(cwd, '..', '..', 'node_modules', '@seedprotocol', 'cli', 'dist', 'bin.js'),
  ]
  
  for (const binPath of possiblePaths) {
    if (fs.existsSync(binPath)) {
      return binPath
    }
  }
  
  return null
}

/**
 * Checks if we're running in the monorepo by looking for the CLI package directory
 * @returns The path to the monorepo root, or null if not in monorepo
 */
function getMonorepoRoot(): string | null {
  // Start from this file's location and walk up to find packages/cli
  let currentDir = __dirname
  
  // Walk up the directory tree looking for packages/cli
  for (let i = 0; i < 10; i++) { // Limit to 10 levels to avoid infinite loops
    const packagesDir = path.join(currentDir, 'packages')
    const cliDir = path.join(packagesDir, 'cli')
    
    if (fs.existsSync(cliDir) && fs.existsSync(path.join(cliDir, 'package.json'))) {
      // Found packages/cli, return the monorepo root (parent of packages)
      return path.dirname(packagesDir)
    }
    
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      // Reached filesystem root
      break
    }
    currentDir = parentDir
  }
  
  return null
}

/**
 * Attempts to import the CLI package, preferring local monorepo version over published package
 * @returns The CLI module or null if not found
 */
async function importCliPackage(): Promise<any> {
  // First, try to import from local monorepo CLI (for development)
  const monorepoRoot = getMonorepoRoot()
  
  if (monorepoRoot) {
    const localCliDistPath = path.join(monorepoRoot, 'packages', 'cli', 'dist', 'index.js')
    const localCliSrcPath = path.join(monorepoRoot, 'packages', 'cli', 'src', 'index.ts')
    
    // Try built dist first (most reliable)
    if (fs.existsSync(localCliDistPath)) {
      try {
        const localCliDistUrl = pathToFileURL(localCliDistPath).href
        const cliModule = await import(localCliDistUrl)
        if (cliModule && typeof cliModule.init === 'function') {
          return cliModule
        }
      } catch (error: any) {
        // Dist import failed, try source
      }
    }
    
    // Try source (for development with tsx/ts-node)
    if (fs.existsSync(localCliSrcPath)) {
      try {
        const localCliSrcUrl = pathToFileURL(localCliSrcPath).href
        const cliModule = await import(localCliSrcUrl)
        if (cliModule && typeof cliModule.init === 'function') {
          return cliModule
        }
      } catch (error: any) {
        // Source import failed (TypeScript not compiled or not using tsx)
      }
    }
  }
  
  // Fall back to published package (for production/consumers)
  // Note: @seedprotocol/cli is not a dependency of the SDK to avoid circular dependencies
  // This is a dynamic import that may not be available in all environments
  try {
    // @ts-ignore - Dynamic import of optional CLI package
    // Using template literal to prevent Vite from statically analyzing this import
    const cliPackageName = '@seedprotocol/cli'
    const cliModule = await import(cliPackageName)
    if (cliModule && typeof cliModule.init === 'function') {
      return cliModule
    }
  } catch (importError: any) {
    // Published package not available
    return null
  }
  
  return null
}

/**
 * Runs seed init programmatically, trying multiple methods:
 * 1. Try to dynamically import and call the CLI package's init function (prefers local monorepo version)
 * 2. Try to find and execute the seed binary
 * 3. Fall back to using npx
 * @param schemaFileDir - Optional path to schema file directory
 * @param appFilesDirPath - Optional path to app files directory
 */
export const runSeedInit = async (
  schemaFileDir?: string,
  appFilesDirPath?: string
): Promise<void> => {

  const dbDirExists = fs.existsSync(`${appFilesDirPath}/db`)
  if (!dbDirExists) {
    fs.mkdirSync(`${appFilesDirPath}/db`, { recursive: true })
  }

  const dbUrl = `file:${appFilesDirPath}/db/seed.db`
  const client = createClient({ url: dbUrl })

  const db = drizzle(client, {schema})

  const { apply, hasDataLoss, warnings, statementsToExecute } = await pushSQLiteSchema(schema, db);
  
  // You can inspect what will happen before applying
  console.log('Statements to execute:', statementsToExecute);
  console.log('Has data loss:', hasDataLoss);
  console.log('Warnings:', warnings);
  
  await apply();


  // // First, try to dynamically import the CLI package's init function
  // // This prefers local monorepo version in development, falls back to published package
  // try {
  //   const cliModule = await importCliPackage()
  //   if (cliModule && typeof cliModule.init === 'function') {
  //     await cliModule.init(schemaFileDir, appFilesDirPath)
  //     return
  //   }
  // } catch (importError: any) {
  //   // CLI package not available, continue to other methods
  //   console.log('[seedInit] CLI package not available, trying binary execution')
  // }
  
  // // Try to find and execute the binary
  // const seedBinary = findSeedBinary()
  
  // if (seedBinary) {
  //   // Binary found, execute it directly
  //   const args = ['init']
  //   if (schemaFileDir) {
  //     args.push(schemaFileDir)
  //   }
  //   if (appFilesDirPath) {
  //     args.push(appFilesDirPath)
  //   }
    
  //   try {
  //     execSync(`node "${seedBinary}" ${args.join(' ')}`, {
  //       stdio: 'inherit',
  //       cwd: process.cwd(),
  //     })
  //     return
  //   } catch (error: any) {
  //     console.warn(`[seedInit] Failed to execute binary at ${seedBinary}: ${error.message}`)
  //     // Continue to npx fallback
  //   }
  // }
  
  // // Final fallback: use npx
  // const args = ['seed', 'init']
  // if (schemaFileDir) {
  //   args.push(schemaFileDir)
  // }
  // if (appFilesDirPath) {
  //   args.push(appFilesDirPath)
  // }
  
  // try {
  //   execSync(`npx ${args.join(' ')}`, {
  //     stdio: 'inherit',
  //     cwd: process.cwd(),
  //   })
  // } catch (error: any) {
  //   throw new Error(
  //     `Failed to run seed init command. ` +
  //     `Tried: CLI package import, binary execution, and npx. ` +
  //     `Please ensure @seedprotocol/cli is installed: ${error.message}`
  //   )
  // }
}

