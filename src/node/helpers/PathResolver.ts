import path from 'path'
import fs from 'fs'
import { SEED_CONFIG_FILE, SEED_CONFIG_FALLBACKS } from '@/helpers/constants'
import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'
import debug from 'debug'

const logger = debug('seedSdk:node:helpers:PathResolver')

class PathResolver extends BasePathResolver {
  /**
   * Detects the current environment based on filesystem structure and package.json
   */
  private detectEnvironment(): 'sdk-dev' | 'linked-sdk' | 'production' | 'test' {
    // Check if we're in the SDK repo itself
    if (process.env.NODE_ENV !== 'test' && this.isInSdkRepo()) {
      return 'sdk-dev'
    }

    // Check if we're running tests
    if (process.env.NODE_ENV === 'test') {
      return 'test'
    }

    // Check if we're using a linked version of the SDK
    if (this.isUsingLinkedSdk()) {
      return 'linked-sdk'
    }

    // Default to production environment
    return 'production'
  }

  private isInSdkRepo(): boolean {
    try {
      // Check if we're in the SDK repo by looking for specific SDK files/directories
      const currentDir = process.cwd()
      return fs.existsSync(path.join(currentDir, 'src', 'node')) &&
             fs.existsSync(path.join(currentDir, 'package.json')) &&
             JSON.parse(fs.readFileSync(path.join(currentDir, 'package.json'), 'utf8')).name === '@seedprotocol/sdk'
    } catch {
      return false
    }
  }

  private isUsingLinkedSdk(): boolean {
    try {
      const pkgPath = path.join(process.cwd(), 'package.json')
      if (!fs.existsSync(pkgPath)) return false
      
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const sdkDep = pkg.dependencies?.['@seedprotocol/sdk']
      
      return sdkDep && (sdkDep.startsWith('link:') || sdkDep.startsWith('portal:'))
    } catch {
      return false
    }
  }

  /**
   * Gets the root directory containing node_modules
   */
  getRootWithNodeModules(): string {
    const processCwd = process.cwd()

    const calledFromMocks = processCwd.includes('__mocks__')

    if (calledFromMocks) {
      return path.join(processCwd, '..', '..', '..', '..',)
    }

    return processCwd
  }

  /**
   * Gets the SDK root directory
   */
  getSdkRootDir(): string {
    const env = this.detectEnvironment()
    const rootWithNodeModules = this.getRootWithNodeModules()
    const processCwd = process.cwd()

    // For test environment, always return the SDK root directory
    if (env === 'test') {
      return rootWithNodeModules
    }

    if (env === 'linked-sdk') {
      // For linked packages, find the package directory
      const pkgJson = JSON.parse(fs.readFileSync(path.join(processCwd, 'package.json'), 'utf8'))
      const sdkPath = pkgJson.dependencies?.['@seedprotocol/sdk'] || pkgJson.devDependencies?.['@seedprotocol/sdk']
      if (sdkPath === 'link:@seedprotocol/sdk') {
        return path.join(processCwd, 'node_modules', '@seedprotocol', 'sdk',)
      }
      return path.resolve(processCwd, sdkPath.replace(/^(link:|portal:)/, ''))
    }

    // After early returns, env can only be 'sdk-dev' or 'production'
    if (env === 'sdk-dev') {
      // This should be {localDir}/seed-protocol-sdk (the SDK root directory)
      return rootWithNodeModules
    }
    
    // Default to production environment
    // This should be {projectDir}/node_modules/@seedprotocol/sdk/dist
    return path.join(rootWithNodeModules, 'node_modules', '@seedprotocol', 'sdk', 'dist')
  }

  getNodeModulesDir(): string {
    const env = this.detectEnvironment()
    const rootWithNodeModules = this.getRootWithNodeModules()

    let nodeModulesDir = path.join(rootWithNodeModules, 'node_modules')

    if (env !== 'linked-sdk' && env !== 'sdk-dev' && nodeModulesDir.includes('__tests__')) {
      nodeModulesDir = path.join(process.cwd(), '..', '..', '..', '..', 'node_modules',)
    }

    return nodeModulesDir
  }

  /**
   * Gets the .seed directory path
   */
  getDotSeedDir(schemaFileDir?: string): string {
    if (!schemaFileDir && process.env.SEED_SDK_TEST_PROJECT_TYPE && !process.cwd().includes('__mocks__')) {
      return path.join(process.cwd(), '__tests__', '__mocks__', process.env.SEED_SDK_TEST_PROJECT_TYPE, 'project', '.seed')
    }
    return path.join(schemaFileDir || process.cwd(), '.seed')
  }

  /**
   * Finds the Seed Protocol config file in the given directory
   * @param searchDir - Directory to search for the config file
   * @returns The path to the found config file, or null if not found
   */
  findConfigFile(searchDir: string = process.cwd()): string | null {
    // First try the primary config file name
    const primaryPath = path.join(searchDir, SEED_CONFIG_FILE)
    if (fs.existsSync(primaryPath)) {
      return primaryPath
    }

    // Then try fallback names in order
    for (const fallbackName of SEED_CONFIG_FALLBACKS) {
      const fallbackPath = path.join(searchDir, fallbackName)
      if (fs.existsSync(fallbackPath)) {
        return fallbackPath
      }
    }

    return null
  }

  /**
   * Gets paths for app-specific directories
   */
  getAppPaths(schemaFileDir?: string | undefined) {
    const env = this.detectEnvironment()
    const dotSeedDir = this.getDotSeedDir(schemaFileDir)
    const nodeModulesDir = this.getNodeModulesDir()

    let drizzleKitPath = path.join(nodeModulesDir, 'drizzle-kit', 'bin.cjs')

    if (env === 'linked-sdk') {
      const sdkRootDir = this.getSdkRootDir()
      const sdkPackageDir = path.dirname(sdkRootDir)
      const sdkNodeModulesDir = path.join(sdkPackageDir, 'node_modules')
      drizzleKitPath = path.join(sdkNodeModulesDir, 'drizzle-kit', 'bin.cjs')
    }

    // Determine the correct template path based on environment
    let templatePath: string
    if (env === 'production') {
      // In production, templates are at dist/node/codegen/templates
      templatePath = path.join(this.getSdkRootDir(), 'node', 'codegen', 'templates')
    } else {
      // In development/test, templates are at src/node/codegen/templates
      templatePath = path.join(this.getSdkRootDir(), 'src', 'node', 'codegen', 'templates')
    }

    logger('env', env)

    logger('getAppPaths', {
      sdkRootDir: this.getSdkRootDir(),
      dotSeedDir,
      nodeModulesDir,
      appSchemaDir: path.join(dotSeedDir, 'schema'),
      appDbDir: path.join(dotSeedDir, 'db'),
      appMetaDir: path.join(dotSeedDir, 'db', 'meta'),
    })

    return {
      sdkRootDir: this.getSdkRootDir(),
      dotSeedDir,
      nodeModulesDir,
      appSchemaDir: path.join(dotSeedDir, 'schema'),
      appDbDir: path.join(dotSeedDir, 'db'),
      appMetaDir: path.join(dotSeedDir, 'db', 'meta'),
      drizzleKitPath,
      templatePath
    }
  }
}

BasePathResolver.setPlatformClass(PathResolver)

export { PathResolver }

