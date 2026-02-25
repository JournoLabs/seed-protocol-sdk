// @ts-nocheck - SDK exports exist but TypeScript can't see them in dist types yet
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import {
  PathResolver,
  createDrizzleSchemaFilesFromConfig,
  commandExists,
} from '@seedprotocol/sdk/node'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pathResolver = PathResolver.getInstance()

/**
 * Copy a directory and all its contents recursively
 * @param {string} sourceDir - Path to the source directory
 * @param {string} targetDir - Path to the target directory
 */
function copyDirectoryRecursively(sourceDir: string, targetDir: string) {
  // Create the target directory if it doesn't exist
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Read all entries in the source directory
  const entries = fs.readdirSync(sourceDir);

  // Process each entry
  for (const entry of entries) {
    // Skip __tests__ directories to prevent recursive copying
    if (entry === '__tests__') {
      console.log(`Skipping __tests__ directory: ${path.join(sourceDir, entry)}`);
      continue;
    }

    const sourcePath = path.join(sourceDir, entry);
    const targetPath = path.join(targetDir, entry);
    
    // Check if the entry is a file or directory
    const stats = fs.statSync(sourcePath);
    
    if (stats.isFile()) {
      // Copy the file directly
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`Copied file: ${sourcePath} → ${targetPath}`);
    } 
    else if (stats.isDirectory()) {
      // Recursively copy the subdirectory
      copyDirectoryRecursively(sourcePath, targetPath);
    }
  }
}

/**
 * Extracts SQL statements from migration files and writes them to a single SQL file
 * @param {string} migrationsFolder - Path to the folder containing migration files
 * @param {string} outputPath - Path to the output SQL file
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

    // Sort migrations by their order (they should already be sorted, but ensure it)
    migrations.sort((a, b) => {
      const aNum = parseInt(a.folderName.match(/^\d+/)?.[0] || '0')
      const bNum = parseInt(b.folderName.match(/^\d+/)?.[0] || '0')
      return aNum - bNum
    })

    // Combine all SQL statements from all migrations
    let combinedSql = `-- Seed Protocol Database Initialization SQL
-- Generated from migration files
-- Total migrations: ${migrations.length}

`

    for (const migration of migrations) {
      combinedSql += `-- Migration: ${migration.folderName}\n`
      combinedSql += `-- Hash: ${migration.hash}\n\n`
      
      // Read the SQL file(s) in the migration folder
      const migrationPath = path.join(migrationsFolder, migration.folderName)
      
      if (fs.existsSync(migrationPath)) {
        const stats = fs.statSync(migrationPath)
        
        if (stats.isDirectory()) {
          // Migration is a directory, look for SQL files inside
          const files = fs.readdirSync(migrationPath)
          const sqlFiles = files.filter(file => file.endsWith('.sql'))
          
          if (sqlFiles.length === 0) {
            console.warn(`[Seed Protocol] No SQL files found in migration folder: ${migration.folderName}`)
          }
          
          for (const sqlFile of sqlFiles.sort()) {
            const sqlFilePath = path.join(migrationPath, sqlFile)
            const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8')
            
            combinedSql += `-- File: ${sqlFile}\n`
            combinedSql += sqlContent.trim()
            combinedSql += '\n\n'
          }
        } else if (stats.isFile() && migrationPath.endsWith('.sql')) {
          // Migration is a single SQL file
          const sqlContent = fs.readFileSync(migrationPath, 'utf-8')
          combinedSql += sqlContent.trim()
          combinedSql += '\n\n'
        }
      } else {
        console.warn(`[Seed Protocol] Migration path does not exist: ${migrationPath}`)
      }
      
      combinedSql += '\n'
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Write the combined SQL to the output file
    fs.writeFileSync(outputPath, combinedSql, 'utf-8')
    console.log(`[Seed Protocol] SQL statements exported to: ${outputPath}`)
    console.log(`[Seed Protocol] Total migrations processed: ${migrations.length}`)
  } catch (error) {
    console.error('[Seed Protocol] Error extracting SQL from migrations:', error)
    throw error
  }
}

export const runExportSql = async (
  schemaFileDir?: string,
  outputPath?: string
) => {
  console.log('[Seed Protocol] Running export-sql command')

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
    // Use the new config file finding logic
    const foundConfigFile = pathResolver.findConfigFile()
    if (foundConfigFile) {
      schemaFileDir = path.dirname(foundConfigFile)
    } else {
      console.error('No config file found. Please create a seed.config.ts, seed.schema.ts, or schema.ts file in your project root.')
      return
    }
  }

  const {
    dotSeedDir,
    appSchemaDir,
    appMetaDir,
    drizzleKitPath,
    sdkRootDir,
  } = pathResolver.getAppPaths(schemaFileDir)

  // Find the actual config file in the schema file directory
  const configFilePath = pathResolver.findConfigFile(schemaFileDir)
  if (!configFilePath) {
    console.error('Config file not found in the specified directory.')
    return
  }

  // Remove dotSeedDir to start fresh each time
  if (fs.existsSync(dotSeedDir)) {
    fs.rmSync(dotSeedDir, { recursive: true, force: true })
  }

  console.log('[Seed Protocol] dotSeedDir', dotSeedDir)

  // Use local tsx from node_modules instead of npx to avoid architecture detection issues
  // Find tsx in the SDK's node_modules (for monorepo) or in the project's node_modules
  let tsxPath = 'tsx' // fallback to tsx in PATH
  const sdkNodeModules = path.join(sdkRootDir, 'node_modules', '.bin', 'tsx')
  const projectNodeModules = path.join(schemaFileDir, 'node_modules', '.bin', 'tsx')
  
  if (fs.existsSync(sdkNodeModules)) {
    tsxPath = sdkNodeModules
  } else if (fs.existsSync(projectNodeModules)) {
    tsxPath = projectNodeModules
  } else if (commandExists('tsx')) {
    tsxPath = 'tsx'
  } else {
    // Last resort: use npx but this might have architecture issues
    tsxPath = 'npx --yes tsx'
  }
  
  const drizzleKitCommand = `${tsxPath} ${drizzleKitPath}`

  const ensureIndexExports = (dirPath: string): void => {
    try {
      // Get all file names in the directory
      const files = fs.readdirSync(dirPath)

      // Filter for .ts files excluding index.ts
      const tsFiles = files.filter(
        (file) => file.endsWith('.ts') && file !== 'index.ts',
      )

      // Check if index.ts exists
      const indexFilePath = path.join(dirPath, 'index.ts')
      try {
        fs.accessSync(indexFilePath)
      } catch (error) {
        console.error(`index.ts not found in the directory: ${dirPath}`)
        return
      }

      // Read the content of index.ts
      const indexContent = fs.readFileSync(indexFilePath, 'utf8')

      // Create export statements for each .ts file
      const exportStatements = tsFiles.map(
        (file) => `export * from './${path.basename(file, '.ts')}';`,
      )

      // Check if each export statement is already present in index.ts
      const missingExports = exportStatements.filter(
        (statement) => !indexContent.includes(statement),
      )

      if (missingExports.length > 0) {
        // Append missing export statements to index.ts
        const newContent =
          indexContent + '\n' + missingExports.join('\n') + '\n'
        fs.writeFileSync(indexFilePath, newContent, 'utf8')
        console.log(
          `Updated index.ts with missing exports:\n${missingExports.join('\n')}`,
        )
      } else {
        console.log('All exports are already present in index.ts')
      }
    } catch (error) {
      console.error(`Error processing directory: ${dirPath}`, error)
    }
  }

  const generateMigrations = async (pathToMeta: string) => {
    try {
      // Create a project-specific Drizzle Kit configuration
      const projectConfigPath = path.join(dotSeedDir, 'drizzle.config.ts')
      const projectConfig = `import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: '${path.join(dotSeedDir, 'schema')}',
  dialect: 'sqlite',
  out: '${path.join(dotSeedDir, 'db')}',
  dbCredentials: {
    url: '${path.join(dotSeedDir, 'db', 'seed.db')}',
  },
})`
      
      fs.writeFileSync(projectConfigPath, projectConfig)
      
      // Only generate migrations, don't run them
      if (!fs.existsSync(pathToMeta)) {
        console.log(`${drizzleKitCommand} generate --config=${projectConfigPath}`)
        execSync(
          `${drizzleKitCommand} generate --config=${projectConfigPath}`,
          { stdio: 'inherit' }
        )
      } else {
        console.log('[Seed Protocol] Migrations already generated, skipping generate step')
      }
    } catch (error) {
      console.error('[Seed Protocol] Error running Drizzle Kit commands:', error)
      throw error
    }
  }

  const runCommands = async () => {
    const tsxExists = commandExists('tsx')
    if (!tsxExists) {
      execSync(`npm install -g tsx`, {stdio: 'inherit'})
    }

    await createDrizzleSchemaFilesFromConfig(configFilePath, appSchemaDir)
    ensureIndexExports(appSchemaDir!)
    await generateMigrations(appMetaDir!)
  }

  // Determine the correct seedSchema path based on environment
  const seedSchemaPath = fs.existsSync(path.join(sdkRootDir, 'src', 'seedSchema'))
    ? path.join(sdkRootDir, 'src', 'seedSchema')
    : path.join(sdkRootDir, 'seedSchema')
  
  copyDirectoryRecursively(
    seedSchemaPath,
    path.join(dotSeedDir, 'schema'),
  )

  console.log('copying', configFilePath, path.join(dotSeedDir, 'seed.config.ts'))

  fs.copyFileSync(configFilePath, path.join(dotSeedDir, 'seed.config.ts'))

  await runCommands()

  // Extract SQL from migrations
  const dbDir = path.join(dotSeedDir, 'db')
  const defaultOutputPath = outputPath 
    ? (path.isAbsolute(outputPath) ? outputPath : path.resolve(schemaFileDir, outputPath))
    : path.join(schemaFileDir, 'init.sql')
  
  extractSqlFromMigrations(dbDir, defaultOutputPath)
  
  console.log('[Seed Protocol] Finished exporting SQL statements')
}
