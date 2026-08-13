// @ts-nocheck - SDK exports exist but TypeScript can't see them in dist types yet
import path from 'path'
import fs from 'fs'
import { PathResolver, resolveSdkDrizzleMigrationsDir } from '@seedprotocol/sdk/node'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const pathResolver = PathResolver.getInstance()

/**
 * Copy a directory and all its contents recursively
 */
function copyDirectoryRecursively(sourceDir: string, targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const entries = fs.readdirSync(sourceDir)

  for (const entry of entries) {
    if (entry === '__tests__') {
      console.log(`Skipping __tests__ directory: ${path.join(sourceDir, entry)}`)
      continue
    }

    const sourcePath = path.join(sourceDir, entry)
    const targetPath = path.join(targetDir, entry)
    const stats = fs.statSync(sourcePath)

    if (stats.isFile()) {
      fs.copyFileSync(sourcePath, targetPath)
      console.log(`Copied file: ${sourcePath} → ${targetPath}`)
    } else if (stats.isDirectory()) {
      copyDirectoryRecursively(sourcePath, targetPath)
    }
  }
}

/**
 * Extracts SQL statements from migration files and writes them to a single SQL file
 */
function extractSqlFromMigrations(migrationsFolder: string, outputPath: string): void {
  try {
    const migrations = readMigrationFiles({
      migrationsFolder: migrationsFolder,
    })

    if (migrations.length === 0) {
      console.warn('[Seed Protocol] No migration files found')
      return
    }

    migrations.sort((a, b) => {
      const aNum = parseInt(a.folderMillis?.toString?.() || a.folderName?.match(/^\d+/)?.[0] || '0', 10)
      const bNum = parseInt(b.folderMillis?.toString?.() || b.folderName?.match(/^\d+/)?.[0] || '0', 10)
      return aNum - bNum
    })

    let combinedSql = `-- Seed Protocol Database Initialization SQL
-- Generated from SDK prebuilt migration files
-- Total migrations: ${migrations.length}

`

    for (const migration of migrations) {
      const folderName = migration.folderName || String(migration.folderMillis || '')
      combinedSql += `-- Migration: ${folderName}\n`
      if (migration.hash) {
        combinedSql += `-- Hash: ${migration.hash}\n`
      }
      combinedSql += `\n`

      const sqlStatements = Array.isArray(migration.sql)
        ? migration.sql
        : typeof migration.sql === 'string'
          ? [migration.sql]
          : []

      for (const statement of sqlStatements) {
        combinedSql += `${statement}\n`
      }
      combinedSql += '\n'
    }

    const outputDir = path.dirname(outputPath)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    fs.writeFileSync(outputPath, combinedSql, 'utf-8')
    console.log(`[Seed Protocol] Wrote SQL to ${outputPath}`)
  } catch (error) {
    console.error('[Seed Protocol] Error extracting SQL from migrations:', error)
    throw error
  }
}

export const runExportSql = async (schemaFileDir?: string, outputPath?: string) => {
  console.log('[Seed Protocol] Exporting SQL from SDK migrations')

  if (schemaFileDir && schemaFileDir.startsWith('.')) {
    const relativePath = schemaFileDir.replace('./', '')
    if (!process.cwd().includes(relativePath)) {
      schemaFileDir = path.resolve(schemaFileDir)
    }
    if (process.cwd().includes(relativePath)) {
      schemaFileDir = process.cwd()
    }
  }

  if (!schemaFileDir && !process.cwd().includes('seed-protocol-sdk')) {
    schemaFileDir = process.cwd()
  }

  console.log('[Seed Protocol] schemaFileDir', schemaFileDir)

  if (!schemaFileDir) {
    const foundConfigFile = pathResolver.findConfigFile()
    if (foundConfigFile) {
      schemaFileDir = path.dirname(foundConfigFile)
    } else {
      console.error(
        'No config file found. Please create a seed.config.ts, seed.schema.ts, or schema.ts file in your project root.',
      )
      return
    }
  }

  const { dotSeedDir, sdkRootDir } = pathResolver.getAppPaths(schemaFileDir)

  const configFilePath = pathResolver.findConfigFile(schemaFileDir)
  if (!configFilePath) {
    console.error('Config file not found in the specified directory.')
    return
  }

  if (fs.existsSync(dotSeedDir)) {
    fs.rmSync(dotSeedDir, { recursive: true, force: true })
  }

  console.log('[Seed Protocol] dotSeedDir', dotSeedDir)

  const seedSchemaPath = fs.existsSync(path.join(sdkRootDir, 'src', 'seedSchema'))
    ? path.join(sdkRootDir, 'src', 'seedSchema')
    : path.join(sdkRootDir, 'seedSchema')

  copyDirectoryRecursively(seedSchemaPath, path.join(dotSeedDir, 'schema'))
  fs.copyFileSync(configFilePath, path.join(dotSeedDir, 'seed.config.ts'))

  // Copy prebuilt SDK migrations (source of truth shared with browser)
  const sdkDrizzleDir = resolveSdkDrizzleMigrationsDir(sdkRootDir)
  const dbDir = path.join(dotSeedDir, 'db')
  copyDirectoryRecursively(sdkDrizzleDir, dbDir)

  const defaultOutputPath = outputPath
    ? path.isAbsolute(outputPath)
      ? outputPath
      : path.resolve(schemaFileDir, outputPath)
    : path.join(schemaFileDir, 'init.sql')

  extractSqlFromMigrations(dbDir, defaultOutputPath)

  console.log('[Seed Protocol] Finished exporting SQL statements')
}
