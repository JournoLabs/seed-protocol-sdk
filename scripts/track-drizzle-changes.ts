#!/usr/bin/env tsx
/**
 * Script to track Drizzle schema changes in src/seedSchema
 *
 * This script:
 * 1. Creates .seed directory if it doesn't exist
 * 2. Checks if migrations have been generated before
 * 3. Runs drizzle-kit generate to detect/create migrations
 * 4. If new migrations are detected, copies them to src/db/drizzle
 * 5. Updates src/browser/db/drizzleFiles.ts with the new migration files
 *
 * MANUAL MIGRATIONS:
 * When adding a migration file manually (e.g. 0006_add_publisher.sql), you MUST also add
 * a matching snapshot file (meta/0006_snapshot.json). Drizzle-kit uses the snapshot chain
 * to detect schema drift—without it, the next `drizzle:track` run will generate a
 * duplicate migration for the same schema changes.
 *
 * To create the snapshot: copy the previous snapshot (e.g. 0005_snapshot.json), apply
 * your migration's schema changes to the JSON, set prevId to the previous snapshot's id,
 * and give it a new unique id. Or use `drizzle-kit generate --custom --name=your_migration`
 * to create an empty migration, then edit the SQL.
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'

const PROJECT_ROOT = process.cwd()
const DOT_SEED_DIR = path.join(PROJECT_ROOT, '.seed')
const DRIZZLE_TEMP_DIR = path.join(DOT_SEED_DIR, 'drizzle-temp')
const DRIZZLE_CONFIG_PATH = path.join(PROJECT_ROOT, 'packages/sdk/src/db/configs/dev.schema.config.ts')
const TARGET_DRIZZLE_DIR = path.join(PROJECT_ROOT, 'packages/sdk/src/db/drizzle')
const DRIZZLE_FILES_TS = path.join(PROJECT_ROOT, 'packages/sdk/src/browser/db/drizzleFiles.ts')
const STATE_DB_PATH = path.join(DOT_SEED_DIR, 'drizzle-state.db')

// Ensure .seed directory exists
function ensureDotSeedDir() {
  if (!fs.existsSync(DOT_SEED_DIR)) {
    console.log('📁 Creating .seed directory...')
    fs.mkdirSync(DOT_SEED_DIR, { recursive: true })
  }
}

// Apply migrations to the state database
async function applyMigrationsToStateDb() {
  // Check if target migrations directory exists
  if (!fs.existsSync(TARGET_DRIZZLE_DIR)) {
    console.log('ℹ️  No migrations directory found, skipping state database update')
    return
  }

  // Ensure .seed directory exists (in case it was deleted)
  ensureDotSeedDir()

  // Connect to the state database using libsql
  // libsql will create the database file if it doesn't exist
  const dbUrl = `file:${STATE_DB_PATH}`
  console.log(`   Database path: ${STATE_DB_PATH}`)
  
  let client
  let db
  try {
    client = createClient({ url: dbUrl })
    db = drizzle(client)
  } catch (error: any) {
    console.error('❌ Error creating database client:', error.message)
    return
  }

  console.log('🔄 Applying migrations to state database...')
  
  try {
    // Apply migrations from the target directory (which has all migrations)
    // This will create the database file if it doesn't exist and apply all migrations
    await migrate(db, { migrationsFolder: TARGET_DRIZZLE_DIR })
    console.log('✅ Migrations applied to state database')
    
    // Verify the database file was created
    if (fs.existsSync(STATE_DB_PATH)) {
      const stats = fs.statSync(STATE_DB_PATH)
      console.log(`   ✅ Database file created: ${stats.size} bytes`)
    } else {
      console.warn('⚠️  Warning: Database file was not created at expected path')
    }
  } catch (error: any) {
    // If migration fails, log the error but don't fail the script
    console.error('❌ Error applying migrations to state database:', error.message)
    if (error.stack) {
      console.error('   Stack:', error.stack)
    }
    // Don't throw - allow script to continue
  }
}

// Read journal file to get current migration state
function readJournal(journalPath: string): { entries: Array<{ tag: string }> } | null {
  if (!fs.existsSync(journalPath)) {
    return null
  }
  try {
    const content = fs.readFileSync(journalPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

// Get all SQL migration files
function getSqlFiles(drizzleDir: string): string[] {
  if (!fs.existsSync(drizzleDir)) {
    return []
  }
  const files = fs.readdirSync(drizzleDir)
    .filter(file => file.endsWith('.sql'))
    .map(file => path.join(drizzleDir, file))
    .sort()
  return files
}

// Get the latest snapshot file
function getLatestSnapshot(metaDir: string): string | null {
  if (!fs.existsSync(metaDir)) {
    return null
  }
  const files = fs.readdirSync(metaDir)
    .filter(file => file.endsWith('_snapshot.json'))
    .sort()
  
  if (files.length === 0) {
    return null
  }
  
  return path.join(metaDir, files[files.length - 1])
}

// Copy generated migrations to target directory
function copyMigrationsToTarget() {
  if (!fs.existsSync(DRIZZLE_TEMP_DIR)) {
    console.error('❌ Error: Drizzle temp directory not found after generation')
    process.exit(1)
  }

  // Remove existing target directory
  if (fs.existsSync(TARGET_DRIZZLE_DIR)) {
    fs.rmSync(TARGET_DRIZZLE_DIR, { recursive: true, force: true })
  }

  // Create target directory
  fs.mkdirSync(TARGET_DRIZZLE_DIR, { recursive: true })

  // Copy all files from temp to target
  const files = fs.readdirSync(DRIZZLE_TEMP_DIR)
  for (const file of files) {
    const srcPath = path.join(DRIZZLE_TEMP_DIR, file)
    const destPath = path.join(TARGET_DRIZZLE_DIR, file)
    
    if (fs.statSync(srcPath).isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true })
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }

  console.log('✅ Copied migrations to packages/sdk/src/db/drizzle')
}

// Update drizzleFiles.ts with the new migration content
function updateDrizzleFiles() {
  const sqlFiles = getSqlFiles(TARGET_DRIZZLE_DIR)
  const metaDir = path.join(TARGET_DRIZZLE_DIR, 'meta')
  const journalFile = path.join(metaDir, '_journal.json')
  const snapshotFile = getLatestSnapshot(metaDir)

  if (sqlFiles.length === 0) {
    console.error('❌ Error: No SQL migration files found')
    process.exit(1)
  }

  if (!fs.existsSync(journalFile)) {
    console.error('❌ Error: Journal file not found')
    process.exit(1)
  }

  if (!snapshotFile || !fs.existsSync(snapshotFile)) {
    console.error('❌ Error: Snapshot file not found')
    process.exit(1)
  }

  // Read all SQL files and create separate exports for each migration
  // This is cleaner than concatenating and splitting by delimiters
  const migrationExports: string[] = []
  for (let i = 0; i < sqlFiles.length; i++) {
    const sqlFile = sqlFiles[i]
    const content = fs.readFileSync(sqlFile, 'utf-8')
    const fileName = path.basename(sqlFile, '.sql')
    // Extract the tag from filename (e.g., "0000_married_malice" from "0000_married_malice.sql")
    const tag = fileName
    
    // Escape template literal special characters
    const escapeTemplateLiteral = (str: string) => {
      return str
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\${/g, '\\${')
    }
    
    migrationExports.push(`export const migrationSql_${tag} = \`${escapeTemplateLiteral(content)}\``)
  }

  // Read JSON files
  const journalJson = fs.readFileSync(journalFile, 'utf-8')
  const snapshotJson = fs.readFileSync(snapshotFile, 'utf-8')

  // Escape template literal special characters
  const escapeTemplateLiteral = (str: string) => {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\${/g, '\\${')
  }

  // Generate the TypeScript file
  const content = `// This file embeds the drizzle migration files as strings for browser runtime
// These files are copied from packages/sdk/src/db/drizzle at build time

// Individual migration SQL files
${migrationExports.join('\n\n')}

// Journal JSON file
export const journalJson = \`${escapeTemplateLiteral(journalJson)}\`

// Snapshot JSON file - this is large, so we'll import it dynamically if needed
// For now, we'll read it from the actual file if ?raw works, otherwise we'll need to embed it
export const snapshotJson = \`${escapeTemplateLiteral(snapshotJson)}\`
`

  fs.writeFileSync(DRIZZLE_FILES_TS, content, 'utf-8')
  console.log('✅ Updated packages/sdk/src/browser/db/drizzleFiles.ts')
}

// Copy existing migrations to temp directory so drizzle-kit can compare against them
function copyExistingMigrationsToTemp() {
  if (!fs.existsSync(TARGET_DRIZZLE_DIR)) {
    console.log('ℹ️  No existing migrations directory found')
    return false
  }

  // Remove temp directory if it exists
  if (fs.existsSync(DRIZZLE_TEMP_DIR)) {
    fs.rmSync(DRIZZLE_TEMP_DIR, { recursive: true, force: true })
  }

  // Create temp directory
  fs.mkdirSync(DRIZZLE_TEMP_DIR, { recursive: true })

  // Copy all files from target to temp
  const files = fs.readdirSync(TARGET_DRIZZLE_DIR)
  for (const file of files) {
    const srcPath = path.join(TARGET_DRIZZLE_DIR, file)
    const destPath = path.join(DRIZZLE_TEMP_DIR, file)
    
    if (fs.statSync(srcPath).isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true })
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }

  console.log('✅ Copied existing migrations to temp directory for drizzle-kit comparison')
  return true
}

// Main execution
async function main() {
  console.log('🔍 Tracking Drizzle schema changes...\n')

  // Ensure .seed directory exists
  ensureDotSeedDir()

  // Check if migrations have been generated before (in the committed directory)
  const targetJournalPath = path.join(TARGET_DRIZZLE_DIR, 'meta', '_journal.json')
  const previousJournal = readJournal(targetJournalPath)
  const previousEntryCount = previousJournal?.entries?.length || 0

  console.log(`📊 Existing migrations in packages/sdk/src/db/drizzle: ${previousEntryCount}`)

  // Initialize state database from existing migrations if it doesn't exist
  const stateDbExists = fs.existsSync(STATE_DB_PATH)
  if (!stateDbExists && previousEntryCount > 0) {
    console.log('📦 Initializing state database from existing migrations...')
    await applyMigrationsToStateDb()
  } else if (stateDbExists) {
    console.log('✅ State database already exists')
    // Ensure it's up-to-date with existing migrations
    console.log('🔄 Ensuring state database is up-to-date with existing migrations...')
    await applyMigrationsToStateDb()
  } else {
    console.log('ℹ️  No existing migrations found - will create fresh state database')
  }

  // Copy existing migrations to temp directory so drizzle-kit can compare against them
  // Drizzle-kit needs to see existing migrations in the output directory to detect changes
  if (previousEntryCount > 0) {
    console.log('\n📋 Copying existing migrations to temp directory for drizzle-kit...')
    copyExistingMigrationsToTemp()
  }

  // Check if config file exists
  if (!fs.existsSync(DRIZZLE_CONFIG_PATH)) {
    console.error(`❌ Error: Drizzle config not found at ${DRIZZLE_CONFIG_PATH}`)
    process.exit(1)
  }

  // Run drizzle-kit generate to detect schema changes
  console.log('\n🔧 Running drizzle-kit generate to detect schema changes...')
  console.log(`   Config: ${DRIZZLE_CONFIG_PATH}`)
  console.log(`   Output dir: ${DRIZZLE_TEMP_DIR}`)
  
  let generateSucceeded = false
  try {
    execSync(
      `bunx drizzle-kit generate --config=${DRIZZLE_CONFIG_PATH}`,
      { stdio: 'inherit', cwd: PROJECT_ROOT }
    )
    generateSucceeded = true
  } catch (error: any) {
    // Check if the error is just about missing snapshot (which might be okay)
    const errorMessage = error.message || String(error) || ''
    if (errorMessage.includes('snapshot') || errorMessage.includes('ENOENT')) {
      console.warn('⚠️  Warning: drizzle-kit had issues with snapshot file')
      console.warn('   This might be okay if migrations were still generated')
      // Continue to check for new migrations
    } else {
      console.error('❌ Error running drizzle-kit generate:', error)
      process.exit(1)
    }
  }

  // Check if temp directory exists and has content
  if (!fs.existsSync(DRIZZLE_TEMP_DIR)) {
    console.warn('⚠️  Warning: Drizzle temp directory was not created')
    console.warn('   This might mean no migrations were generated or drizzle-kit used a different output path')
  }

  // Check if new migrations were created
  const tempJournalPath = path.join(DRIZZLE_TEMP_DIR, 'meta', '_journal.json')
  const newJournal = readJournal(tempJournalPath)
  const newEntryCount = newJournal?.entries?.length || 0

  console.log(`\n📊 Migration count after generate: ${newEntryCount}`)
  console.log(`   (Previous: ${previousEntryCount}, New: ${newEntryCount - previousEntryCount})`)
  
  // Check if there are new SQL files
  const tempSqlFiles = getSqlFiles(DRIZZLE_TEMP_DIR)
  const targetSqlFiles = getSqlFiles(TARGET_DRIZZLE_DIR)
  const newSqlFiles = tempSqlFiles.filter(tempFile => {
    const tempBasename = path.basename(tempFile)
    return !targetSqlFiles.some(targetFile => path.basename(targetFile) === tempBasename)
  })
  
  if (newSqlFiles.length > 0) {
    console.log(`   ✨ Found ${newSqlFiles.length} new SQL migration file(s): ${newSqlFiles.map(f => path.basename(f)).join(', ')}`)
  }

  // Determine if we have new migrations by comparing SQL files
  // This is more reliable than journal entries since drizzle-kit might have errors
  const hasNewMigrations = newSqlFiles.length > 0

  if (!hasNewMigrations) {
    console.log('ℹ️  No new migrations generated (schema is up-to-date)')
    // Clean up temp directory (but keep state database if it exists)
    if (fs.existsSync(DRIZZLE_TEMP_DIR)) {
      fs.rmSync(DRIZZLE_TEMP_DIR, { recursive: true, force: true })
    }
    
    // Even if no new migrations, ensure state database is up-to-date with existing migrations
    if (previousEntryCount > 0) {
      console.log('🔄 Ensuring state database is up-to-date...')
      await applyMigrationsToStateDb()
      
      // Update drizzleFiles.ts to ensure it has the latest format (with delimiters)
      // This is important for fixing the migration splitting issue
      console.log('🔄 Updating drizzleFiles.ts with latest format...')
      updateDrizzleFiles()
    }
    return
  }

  // We have new migrations!
  console.log(`✨ New migrations detected: ${newSqlFiles.map(f => path.basename(f)).join(', ')}`)
  
  // Copy all migrations (existing + new) to target directory
  copyMigrationsToTarget()
  
  // Apply all migrations to state database (mirrors what external users will have)
  await applyMigrationsToStateDb()
  
  // Update drizzleFiles.ts
  updateDrizzleFiles()
  
  // Clean up temp directory (but keep state database if it exists)
  if (fs.existsSync(DRIZZLE_TEMP_DIR)) {
    fs.rmSync(DRIZZLE_TEMP_DIR, { recursive: true, force: true })
  }
  
  console.log('\n✅ Successfully tracked and updated Drizzle migrations!')
  console.log(`   - SQL migrations: ${getSqlFiles(TARGET_DRIZZLE_DIR).map(f => path.basename(f)).join(', ')}`)
  const snapshotFile = getLatestSnapshot(path.join(TARGET_DRIZZLE_DIR, 'meta'))
  if (snapshotFile) {
    console.log(`   - Snapshot: ${path.basename(snapshotFile)}`)
  }
  console.log(`   - State database: ${path.relative(PROJECT_ROOT, STATE_DB_PATH)}`)
}

main().catch((error) => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
