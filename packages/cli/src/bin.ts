#!/usr/bin/env node
// @ts-nocheck - SDK exports exist but TypeScript can't see them in dist types yet
import path from 'path'
import fs                        from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import process                          from 'node:process'
import { Command } from 'commander'
import {
  PathResolver,
  appState,
  config,
  metadata,
  models,
  modelUids,
  seeds,
  versions,
} from '@seedprotocol/sdk/node'
import { runInit } from './init'
import { runExportSql } from './export-sql'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pathResolver = PathResolver.getInstance()
const program = new Command()

export const seedDatabase = async (seedDataPath: string, dotSeedDir?: string) => {
  console.log('[Seed Protocol] Running seed script')

  try {
    // OLD CODE: Import better-sqlite3 dynamically to handle optional dependency
    // Try to resolve from the project's node_modules first, then fall back to SDK's node_modules
    // let drizzle: any
    // let Database: any
    
    // Get the project directory first (needed for both module resolution and database path)
    const actualDotSeedDir = dotSeedDir || pathResolver.getDotSeedDir()
    const projectDir = path.dirname(actualDotSeedDir)
    
    // OLD CODE: Try to resolve better-sqlite3 from the project directory first
    // const projectBetterSqlite3Path = path.join(projectDir, 'node_modules', 'better-sqlite3')
    // 
    // let betterSqlite3Module: any
    // if (fs.existsSync(projectBetterSqlite3Path)) {
    //   // Use createRequire to resolve from project's node_modules
    //   const { createRequire } = await import('module')
    //   const projectRequire = createRequire(path.join(projectDir, 'package.json'))
    //   betterSqlite3Module = projectRequire('better-sqlite3')
    //   // better-sqlite3 is a CommonJS module, so it might not have a default export
    //   Database = betterSqlite3Module.default || betterSqlite3Module
    // } else {
    //   // Fall back to regular import (from SDK's node_modules)
    //   betterSqlite3Module = await import('better-sqlite3')
    //   Database = betterSqlite3Module.default
    // }
    
    // NEW CODE: Use libsql instead of better-sqlite3
    let drizzle: any
    let createClient: any
    
    try {
      const drizzleModule = await import('drizzle-orm/libsql')
      drizzle = drizzleModule.drizzle

      // Resolve @libsql/client from project's node_modules first, then fall back to SDK's node_modules
      const projectLibsqlClientPath = path.join(projectDir, 'node_modules', '@libsql', 'client')
      if (fs.existsSync(projectLibsqlClientPath)) {
        try {
          // Use createRequire to resolve from project's node_modules
          const { createRequire } = await import('module')
          const projectRequire = createRequire(path.join(projectDir, 'package.json'))
          const libsqlClientModule = projectRequire('@libsql/client')
          createClient = libsqlClientModule.createClient || libsqlClientModule.default?.createClient || libsqlClientModule.default
        } catch (requireError) {
          // If createRequire fails, try direct import
          const libsqlClientModule = await import('@libsql/client')
          createClient = libsqlClientModule.createClient
        }
      } else {
        // Fall back to regular import (from SDK's node_modules)
        const libsqlClientModule = await import('@libsql/client')
        createClient = libsqlClientModule.createClient
      }
    } catch (importError) {
      console.error('[Seed Protocol] Error: @libsql/client is required for seeding the database.')
      console.error('[Seed Protocol] Please install @libsql/client: npm install @libsql/client')
      process.exit(1)
    }
    
    // Read the seed data file
    const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'))
    
    // Connect to the database
    const dbDir = path.join(actualDotSeedDir, 'db')
    const dbPath = path.join(dbDir, 'seed.db')
    
    // Ensure the database directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    
    // OLD CODE: const sqlite = new Database(dbPath)
    // OLD CODE: const db = drizzle(sqlite)
    
    // NEW CODE: Use libsql client with file: URL
    const dbUrl = `file:${path.resolve(dbPath)}`
    const client = createClient({ url: dbUrl })
    const db = drizzle(client)
    
    // Seed each table based on the provided data
    if (seedData.appState && seedData.appState.length > 0) {
      await db.insert(appState).values(seedData.appState)
      console.log('Seeded appState table')
    }
    
    if (seedData.config && seedData.config.length > 0) {
      await db.insert(config).values(seedData.config)
      console.log('Seeded config table')
    }
    
    if (seedData.models && seedData.models.length > 0) {
      await db.insert(models).values(seedData.models)
      console.log('Seeded models table')
    }
    
    if (seedData.modelUids && seedData.modelUids.length > 0) {
      await db.insert(modelUids).values(seedData.modelUids)
      console.log('Seeded modelUids table')
    }
    
    if (seedData.metadata && seedData.metadata.length > 0) {
      await db.insert(metadata).values(seedData.metadata)
      console.log('Seeded metadata table')
    }
    
    if (seedData.seeds && seedData.seeds.length > 0) {
      await db.insert(seeds).values(seedData.seeds)
      console.log('Seeded seeds table')
    }
    
    if (seedData.versions && seedData.versions.length > 0) {
      await db.insert(versions).values(seedData.versions)
      console.log('Seeded versions table')
    }
    
    console.log('[Seed Protocol] Successfully seeded database')
  } catch (error) {
    console.error('[Seed Protocol] Error seeding database:', error)
    process.exit(1)
  }
}


// Configure Commander program
program
  .name('seed')
  .description('CLI tool for Seed Protocol')
  .version('0.3.32')

program
  .command('init')
  .description('Initialize the database')
  .argument('[schemaPath]', 'Path to the schema file directory')
  .argument('[appFilesPath]', 'Path to the app files directory')
  .action(async (schemaPath?: string, appFilesPath?: string) => {
    await runInit(schemaPath, appFilesPath)
  })

program
  .command('seed')
  .description('Seed the database with data from JSON file')
  .argument('<seedDataPath>', 'Path to the seed data JSON file')
  .action(async (seedDataPath: string) => {
    await seedDatabase(seedDataPath)
  })

program
  .command('export-sql')
  .description('Export SQL statements for initializing the database')
  .argument('[schemaPath]', 'Path to the schema file directory')
  .argument('[outputPath]', 'Path to the output SQL file (defaults to init.sql in schema directory)')
  .action(async (schemaPath?: string, outputPath?: string) => {
    await runExportSql(schemaPath, outputPath)
  })

// Parse command line arguments
const calledFrom = pathToFileURL(process.argv[1]).href

console.log('calledFrom', calledFrom)

if (
  calledFrom.endsWith('node_modules/.bin/seed') ||
  calledFrom.endsWith('node_modules/@seedprotocol/cli/dist/bin.js') ||
  import.meta.url.endsWith('@seedprotocol/cli/dist/bin.js') ||
  import.meta.url.endsWith('packages/cli/src/bin.ts') ||
  import.meta.url.endsWith('dist/bin.js')
) {
  // module was not imported but called directly
  program.parse()
}

export { runInit as init } from './init'
