import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'

class PathResolver extends BasePathResolver {
  /**
   * Gets the root directory containing node_modules
   * Note: In browser, this returns a virtual path based on OPFS
   */
  getRootWithNodeModules(): string {
    // In browser, we use OPFS which doesn't have traditional paths
    // Return a virtual root path
    return '/'
  }

  /**
   * Gets the SDK root directory
   * Note: In browser, this returns a virtual path
   */
  getSdkRootDir(): string {
    // In browser, SDK is bundled, so we return a virtual path
    return '/sdk'
  }

  getNodeModulesDir(): string {
    // In browser, node_modules don't exist in the traditional sense
    return '/node_modules'
  }

  /**
   * Gets the .seed directory path
   * Note: In browser, this returns the OPFS path where .seed data is stored
   */
  getDotSeedDir(schemaFileDir?: string): string {
    // In browser, .seed directory is stored in OPFS
    // The actual path is handled by the FileManager
    return '/.seed'
  }

  /**
   * Finds the Seed Protocol config file
   * Note: In browser, config files are not accessible via filesystem
   */
  findConfigFile(searchDir?: string): string | null {
    // In browser, config files are typically embedded in the bundle
    // or loaded via fetch/import
    return null
  }

  /**
   * Gets paths for app-specific directories
   * Note: In browser, these are virtual paths for OPFS
   */
  getAppPaths(schemaFileDir?: string | undefined) {
    const dotSeedDir = this.getDotSeedDir(schemaFileDir)

    return {
      sdkRootDir: this.getSdkRootDir(),
      dotSeedDir,
      nodeModulesDir: this.getNodeModulesDir(),
      appSchemaDir: `${dotSeedDir}/schema`,
      appDbDir: `${dotSeedDir}/db`,
      appMetaDir: `${dotSeedDir}/db/meta`,
      drizzleKitPath: `${this.getNodeModulesDir()}/drizzle-kit/bin.cjs`,
      templatePath: `${this.getSdkRootDir()}/node/codegen/templates`
    }
  }
}

BasePathResolver.setPlatformClass(PathResolver)

export { PathResolver }

