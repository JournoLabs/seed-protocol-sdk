// @ts-nocheck - SDK exports exist but TypeScript can't see them in dist types yet
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { rimrafSync } from 'rimraf'
import {
  PathResolver,
  createDrizzleSchemaFilesFromConfig,
  getTsImport,
  commandExists,
  INIT_SCRIPT_SUCCESS_MESSAGE,
} from '@seedprotocol/sdk/node'
import type { ModelClassType } from '@seedprotocol/sdk'
import { seedDatabase } from './bin'

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

export const runInit = async (schemaFileDir?: string, appFilesDirPath?: string) => {
  console.log('[Seed Protocol] Running init script')

  if (schemaFileDir && schemaFileDir.startsWith('.')) {
    const relativePath = schemaFileDir.replace('./', '')
    if (!process.cwd().includes(relativePath)) {
      schemaFileDir = path.resolve(schemaFileDir,)
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
    drizzleDbConfigPath,
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

  const copyDotSeedFilesToAppFiles = async (_appFilesDirPath: string) => {
    console.log('[Seed Protocol] Copying dot seed files to app files')
    const { endpoints } = await getTsImport<{
      models: Record<string, ModelClassType>,
      endpoints: Record<string, string>
    }>(configFilePath)

    const outputDirPath = endpoints.localOutputDir || _appFilesDirPath

    const exists = await fs.promises.access(outputDirPath).then(() => true).catch(() => false)
    if (exists) {
      await fs.promises.rm(outputDirPath, { recursive: true, force: true })
    }
    
    console.log(`[Seed Protocol] making dir at ${outputDirPath}`)
    fs.mkdirSync(outputDirPath, { recursive: true })
    console.log('[Seed Protocol] copying app files')
    
    // Use copyDirectoryRecursively instead of fs.cpSync to exclude __tests__ directories
    copyDirectoryRecursively(dotSeedDir, outputDirPath)
    
    console.log('[Seed Protocol] removing sqlite3 files and index.ts files')
    rimrafSync(`${outputDirPath}/**/*.sqlite3`, { glob: true })
    rimrafSync(`${outputDirPath}/**/*.db`, { glob: true })
    rimrafSync(`${outputDirPath}/**/index.ts`, { glob: true })
  }

  const updateSchema = async (pathToConfig: string, pathToMeta: string) => {
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
      
      if (!fs.existsSync(pathToMeta)) {
        console.log(`${drizzleKitCommand} generate --config=${projectConfigPath}`)
        execSync(
          `${drizzleKitCommand} generate --config=${projectConfigPath}`,
          { stdio: 'inherit' }
        )
      }
      console.log(`${drizzleKitCommand} migrate --config=${projectConfigPath}`)
      execSync(`${drizzleKitCommand} migrate --config=${projectConfigPath}`, { stdio: 'inherit' })
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
    await updateSchema(drizzleDbConfigPath, appMetaDir!)
    const seedDataFilePath = path.join(__dirname, 'seedData.json')
    await seedDatabase(seedDataFilePath, dotSeedDir)
  }

  // Determine the correct seedSchema path based on environment
  const seedSchemaPath = fs.existsSync(path.join(sdkRootDir, 'src', 'seedSchema'))
    ? path.join(sdkRootDir, 'src', 'seedSchema')
    : path.join(sdkRootDir, 'seedSchema')
  
  copyDirectoryRecursively(
    seedSchemaPath,
    path.join(dotSeedDir, 'schema'),
  )

  // copyDirectoryRecursively(
  //   path.join(pathResolver.getSdkRootDir(), 'node', 'codegen'),
  //   path.join(dotSeedDir, 'codegen'),
  // )

  console.log('copying', configFilePath, path.join(dotSeedDir, 'seed.config.ts'))

  fs.copyFileSync(configFilePath, path.join(dotSeedDir, 'seed.config.ts'))

  runCommands()
    .then(() => {
      if (!appFilesDirPath) {
        console.log('[Seed Protocol] Finished running init script')
      } else {
        return copyDotSeedFilesToAppFiles(appFilesDirPath)
      }
    })
    .then(() => {
      console.log(INIT_SCRIPT_SUCCESS_MESSAGE)
    })
}

