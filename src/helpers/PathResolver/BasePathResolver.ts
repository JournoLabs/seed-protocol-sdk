export abstract class BasePathResolver {
  private static instance: BasePathResolver
  private static PlatformClass: typeof BasePathResolver

  static setPlatformClass(platformClass: typeof BasePathResolver) {
    this.PlatformClass = platformClass
  }

  static getInstance(): BasePathResolver {
    if (!BasePathResolver.instance) {
      if (!BasePathResolver.PlatformClass) {
        throw new Error('PathResolver PlatformClass not set. Please ensure the platform-specific PathResolver is imported. For Node.js, import from @seedprotocol/sdk/node. For browser, the SDK should auto-initialize.')
      }
      if (BasePathResolver.PlatformClass === BasePathResolver) {
        throw new Error('Circular reference detected: PlatformClass is set to BasePathResolver')
      }
      BasePathResolver.instance = new BasePathResolver.PlatformClass()
    }
    return BasePathResolver.instance
  }

  abstract getRootWithNodeModules(): string
  abstract getSdkRootDir(): string
  abstract getNodeModulesDir(): string
  abstract getDotSeedDir(schemaFileDir?: string): string
  abstract findConfigFile(searchDir?: string): string | null
  abstract getAppPaths(schemaFileDir?: string | undefined): {
    sdkRootDir: string
    dotSeedDir: string
    nodeModulesDir: string
    appSchemaDir: string
    appDbDir: string
    appMetaDir: string
    drizzleDbConfigPath: string
    drizzleKitPath: string
    templatePath: string
  }
}

