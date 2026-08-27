import type {
  DownloadAllFilesParams,
  DownloadSingleFileParams,
  IFileManager,
  ResizeAllImagesParams,
  ResizeImageParams,
} from './IFileManager'

export abstract class BaseFileManager {
  private static fileSystemInitialized = false
  private static initializing = false
  private static workingDir: string | undefined
  private static _impl: IFileManager | null = null

  static configure(impl: IFileManager): void {
    if (!impl) {
      throw new Error(
        'Cannot configure FileManager with undefined or null. Ensure the platform-specific FileManager is properly created.',
      )
    }
    BaseFileManager._impl = impl
  }

  private static requireImpl(): IFileManager {
    if (!BaseFileManager._impl) {
      throw new Error(
        'FileManager not configured. Call BaseFileManager.configure() during platform init.',
      )
    }
    return BaseFileManager._impl
  }

  static async initializeFileSystem(workingDir?: string): Promise<void> {
    if (this.initializing || this.fileSystemInitialized) {
      return Promise.resolve()
    }
    this.initializing = true
    await BaseFileManager.requireImpl().initializeFileSystem(workingDir)
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

  /**
   * Build a path under the configured files root (e.g. /app-files).
   * Use this instead of hardcoding /files/ for images, html, json, etc.
   * @param subpaths - path segments to join (e.g. 'images', fileName)
   * @returns full path like /app-files/images/egg.jpg
   */
  static getFilesPath(...subpaths: string[]): string {
    const root = this.getWorkingDir().replace(/\/$/, '')
    const parts = [root, ...subpaths].filter(Boolean)
    return parts.join('/').replace(/\/+/g, '/')
  }

  static getContentUrlFromPath(path: string): Promise<string | undefined> {
    return BaseFileManager.requireImpl().getContentUrlFromPath(path)
  }

  static downloadAllFiles({
    transactionIds,
    arweaveHost,
    excludedTransactions,
  }: DownloadAllFilesParams): Promise<void> {
    return BaseFileManager.requireImpl().downloadAllFiles({
      transactionIds,
      arweaveHost,
      excludedTransactions,
    })
  }

  static downloadFileByTransactionId({
    transactionId,
    arweaveHost,
    excludedTransactions,
  }: DownloadSingleFileParams): Promise<void> {
    return BaseFileManager.requireImpl().downloadAllFiles({
      transactionIds: [transactionId],
      arweaveHost,
      excludedTransactions,
    })
  }

  static resizeImage({ filePath, width, height }: ResizeImageParams): Promise<void> {
    return BaseFileManager.requireImpl().resizeImage({ filePath, width, height })
  }

  static resizeAllImages({ width, height }: ResizeAllImagesParams): Promise<void> {
    return BaseFileManager.requireImpl().resizeAllImages({ width, height })
  }

  static pathExists(filePath: string): Promise<boolean> {
    return BaseFileManager.requireImpl().pathExists(filePath)
  }

  /**
   * Returns a list of filenames in the given directory (e.g. 'images', 'files').
   */
  static listFiles(dir: string): Promise<string[]> {
    return BaseFileManager.requireImpl().listFiles(dir)
  }

  /**
   * Returns a list of image filenames in the images folder (originals only, excludes size subdirs).
   * Use this to get all stored images without traversing 480/760/1024/1440/1920 subdirectories.
   */
  static listImageFiles(): Promise<string[]> {
    return this.listFiles('images')
  }

  static createDirIfNotExists(filePath: string): Promise<void> {
    return BaseFileManager.requireImpl().createDirIfNotExists(filePath)
  }

  static async waitForFile(filePath: string): Promise<boolean> {
    return BaseFileManager.requireImpl().waitForFile(filePath)
  }

  static async waitForFileWithContent(
    filePath: string,
    interval?: number,
    timeout?: number,
  ): Promise<boolean> {
    return BaseFileManager.requireImpl().waitForFileWithContent(filePath, interval, timeout)
  }

  static async saveFile(filePath: string, content: string | Blob | ArrayBuffer): Promise<void> {
    return BaseFileManager.requireImpl().saveFile(filePath, content)
  }

  static saveFileSync(filePath: string, content: string | Blob | ArrayBuffer): void {
    return BaseFileManager.requireImpl().saveFileSync(filePath, content)
  }

  static async readFile(filePath: string): Promise<File> {
    return BaseFileManager.requireImpl().readFile(filePath)
  }

  static readFileSync(filePath: string): File {
    return BaseFileManager.requireImpl().readFileSync(filePath)
  }

  static async readFileAsBuffer(filePath: string): Promise<Buffer | Blob> {
    return BaseFileManager.requireImpl().readFileAsBuffer(filePath)
  }

  static async readFileAsString(filePath: string): Promise<string> {
    return BaseFileManager.requireImpl().readFileAsString(filePath)
  }

  static async getFs(): Promise<any> {
    return BaseFileManager.requireImpl().getFs()
  }

  static getFsSync(): any {
    return BaseFileManager.requireImpl().getFsSync()
  }

  static getPathModule(): any {
    return BaseFileManager.requireImpl().getPathModule()
  }

  static getParentDirPath(filePath: string): string {
    return BaseFileManager.requireImpl().getParentDirPath(filePath)
  }

  static getFilenameFromPath(filePath: string): string {
    return BaseFileManager.requireImpl().getFilenameFromPath(filePath)
  }
}
