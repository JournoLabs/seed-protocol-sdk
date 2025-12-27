export abstract class BaseFileManager {
  private static fileSystemInitialized = false
  private static initializing = false
  private static workingDir: string | undefined

  static PlatformClass: typeof BaseFileManager

  static setPlatformClass( platformClass: typeof BaseFileManager ) {
    if (!platformClass) {
      throw new Error('Cannot set PlatformClass to undefined or null. Ensure the platform-specific FileManager is properly imported.')
    }
    if (platformClass === BaseFileManager) {
      throw new Error('Cannot set PlatformClass to BaseFileManager itself. Use a platform-specific implementation (e.g., node/FileManager or browser/FileManager).')
    }
    this.PlatformClass = platformClass
  }

  static async initializeFileSystem(workingDir?: string): Promise<void> {
    if (this.initializing || this.fileSystemInitialized) {
      return Promise.resolve()
    }
    this.initializing = true
    await this.PlatformClass.initializeFileSystem(workingDir)
    this.fileSystemInitialized = true
    this.initializing = false
    this.workingDir = workingDir
  }

  static getWorkingDir(): string {
    if (!this.workingDir) {
      throw new Error('Working directory is not set')
    }
    return this.workingDir
  }

  static getContentUrlFromPath( path: string ): Promise<string | undefined> {
    return this.PlatformClass.getContentUrlFromPath(path)
  }

  static downloadAllFiles( {
                             transactionIds,
                             arweaveHost,
                             excludedTransactions,
                           }: DownloadAllFilesParams ): Promise<void> {
    return this.PlatformClass.downloadAllFiles({ transactionIds, arweaveHost, excludedTransactions })
  }

  static resizeImage( { filePath, width, height }: ResizeImageParams ): Promise<void> {
    return this.PlatformClass.resizeImage({ filePath, width, height })
  }

  static resizeAllImages( { width, height }: ResizeAllImagesParams ): Promise<void> {
    return this.PlatformClass.resizeAllImages({ width, height })
  }

  static pathExists(filePath: string): Promise<boolean> {
    return this.PlatformClass.pathExists(filePath)
  }

  static createDirIfNotExists(filePath: string): Promise<void> {
    return this.PlatformClass.createDirIfNotExists(filePath)
  }

  static async waitForFile(filePath: string): Promise<boolean> {
    return this.PlatformClass.waitForFile(filePath)
  }

  static async waitForFileWithContent(filePath: string, interval?: number, timeout?: number): Promise<boolean> {
    return this.PlatformClass.waitForFileWithContent(filePath, interval, timeout)
  }

  static async saveFile(filePath: string, content: string | Blob | ArrayBuffer): Promise<void> {
    return this.PlatformClass.saveFile(filePath, content)
  }

  static saveFileSync(filePath: string, content: string | Blob | ArrayBuffer): void {
    return this.PlatformClass.saveFileSync(filePath, content)
  }

  static async readFile(filePath: string): Promise<File> {
    return this.PlatformClass.readFile(filePath)
  }

  static readFileSync(filePath: string): File {
    return this.PlatformClass.readFileSync(filePath)
  }

  static async readFileAsBuffer(filePath: string): Promise<Buffer | Blob> {
    return this.PlatformClass.readFileAsBuffer(filePath)
  }

  static async readFileAsString(filePath: string): Promise<string> {
    return this.PlatformClass.readFileAsString(filePath)
  }

  static async getFs(): Promise<any> {
    if (!this.PlatformClass) {
      throw new Error('PlatformClass not set. Call setPlatformClass() first.')
    }
    if (this.PlatformClass === BaseFileManager) {
      throw new Error('Circular reference detected: PlatformClass is set to BaseFileManager')
    }
    // Check if the getFs method is the same as BaseFileManager.getFs (catches cases where
    // PlatformClass doesn't properly override getFs or bundling causes method sharing)
    if (this.PlatformClass.getFs === BaseFileManager.getFs) {
      throw new Error('Circular reference detected: PlatformClass.getFs is the same as BaseFileManager.getFs')
    }
    // Check if we're calling ourselves recursively (more reliable than function reference comparison)
    // This will catch actual infinite recursion regardless of how the code is bundled/transpiled
    const stack = new Error().stack || ''
    const getFsCalls = (stack.match(/getFs/g) || []).length
    if (getFsCalls > 10) {
      throw new Error('Infinite recursion detected in getFs')
    }
    return this.PlatformClass.getFs()
  }

  static getFsSync(): any {
    if (!this.PlatformClass) {
      throw new Error('PlatformClass not set. Call setPlatformClass() first.')
    }
    if (this.PlatformClass === BaseFileManager) {
      throw new Error('Circular reference detected: PlatformClass is set to BaseFileManager')
    }
    // Check if getFsSync method exists on platform class
    if (typeof this.PlatformClass.getFsSync !== 'function') {
      throw new Error('PlatformClass does not implement getFsSync()')
    }
    return this.PlatformClass.getFsSync()
  }

  static getPathModule(): any {
    return this.PlatformClass.getPathModule()
  }

  static getParentDirPath(filePath: string): string {
    return this.PlatformClass.getParentDirPath(filePath)
  }

  static getFilenameFromPath(filePath: string): string {
    return this.PlatformClass.getFilenameFromPath(filePath)
  }
}
