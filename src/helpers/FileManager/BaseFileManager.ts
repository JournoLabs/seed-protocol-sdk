export abstract class BaseFileManager {
  private static fileSystemInitialized = false
  private static initializing = false

  static PlatformClass: typeof BaseFileManager

  static setPlatformClass( platformClass: typeof BaseFileManager ) {
    this.PlatformClass = platformClass
  }

  static async initializeFileSystem(): Promise<void> {
    if (this.initializing || this.fileSystemInitialized) {
      return Promise.resolve()
    }
    this.initializing = true
    await this.PlatformClass.initializeFileSystem()
    this.fileSystemInitialized = true
    this.initializing = false
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

  static async saveFile(filePath: string, content: string | Blob | ArrayBuffer): Promise<void> {
    return this.PlatformClass.saveFile(filePath, content)
  }

  static async readFile(filePath: string): Promise<File> {
    return this.PlatformClass.readFile(filePath)
  }
}
