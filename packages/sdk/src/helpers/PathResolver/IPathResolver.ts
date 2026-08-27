export interface IPathResolver {
  getRootWithNodeModules(): string
  getSdkRootDir(): string
  getNodeModulesDir(): string
  getDotSeedDir(schemaFileDir?: string): string
  findConfigFile(searchDir?: string): string | null
  getAppPaths(schemaFileDir?: string | undefined): {
    sdkRootDir: string
    dotSeedDir: string
    nodeModulesDir: string
    appSchemaDir: string
    appDbDir: string
    appMetaDir: string
  }
}
