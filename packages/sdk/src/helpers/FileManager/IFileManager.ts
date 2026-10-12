export type DownloadAllFilesParams = {
  transactionIds: string[]
  arweaveHost: string
  /** Ordered read gateways (scheme + host + path) tried before `arweaveHost`; see `getArweaveReadBaseUrls`. */
  arweaveBaseUrls?: string[]
  excludedTransactions: Set<string>
  /**
   * Content-SHA-256 tag values by transaction id. A download with one is saved only when its bytes
   * match (SHA-256, or SHA3-256 for uploads from SDK 0.7.2 and earlier); see `contentSha256TagMatches`.
   */
  expectedContentHashes?: Record<string, string>
  /**
   * Where each child of a composite upload is saved, by transaction id then child (property) name:
   * a path relative to the files root, the one the SDK reads that ItemStorage property from. See
   * `getCompositeChildPaths`. Children without one use the legacy html / json layout.
   */
  compositeChildPaths?: Record<string, Record<string, string>>
}

/** What a browser download run did, by transaction id. */
export type DownloadAllFilesResult = {
  /** Bytes matched the expected Content-SHA-256 and were saved. */
  verifiedTransactionIds: string[]
  /** No gateway served bytes matching the expected Content-SHA-256; nothing was saved. */
  hashMismatchTransactionIds: string[]
  /** Saving failed (e.g. an OPFS write error). */
  failedTransactionIds: string[]
}

export type DownloadSingleFileParams = {
  transactionId: string
  arweaveHost: string
  /** Ordered read gateways (scheme + host + path) tried before `arweaveHost`; see `getArweaveReadBaseUrls`. */
  arweaveBaseUrls?: string[]
  excludedTransactions: Set<string>
  /** Content-SHA-256 tag value to verify the download against; see {@link DownloadAllFilesParams}. */
  expectedContentHash?: string
  /** Where this transaction's composite children go, by child name; see {@link DownloadAllFilesParams}. */
  compositeChildPaths?: Record<string, string>
}

export type ResizeAllImagesParams = {
  width: number
  height: number
}

export type ResizeImageParams = {
  filePath: string
  width: number
  height: number
}

export interface IFileManager {
  initializeFileSystem(workingDir?: string): Promise<void>
  getContentUrlFromPath(path: string): Promise<string | undefined>
  downloadAllFiles(params: DownloadAllFilesParams): Promise<DownloadAllFilesResult | void>
  resizeImage(params: ResizeImageParams): Promise<void>
  resizeAllImages(params: ResizeAllImagesParams): Promise<void>
  pathExists(filePath: string): Promise<boolean>
  /**
   * Re-reads paths another tab or a worker changed outside this file system's cache (browser).
   * A no-op where nothing is cached (Node).
   */
  invalidateCachedPaths(filePaths: string[]): Promise<void>
  /** File size in bytes, or null if the path does not exist / cannot be stated. */
  getFileSize(filePath: string): Promise<number | null>
  listFiles(dir: string): Promise<string[]>
  listImageFiles(): Promise<string[]>
  createDirIfNotExists(filePath: string): Promise<void>
  waitForFile(filePath: string, interval?: number, timeout?: number): Promise<boolean>
  waitForFileWithContent(filePath: string, interval?: number, timeout?: number): Promise<boolean>
  saveFile(filePath: string, content: string | Blob | ArrayBuffer): Promise<void>
  saveFileSync(filePath: string, content: string | Blob | ArrayBuffer): void
  readFile(filePath: string): Promise<File>
  readFileSync(filePath: string): File
  readFileAsBuffer(filePath: string): Promise<Buffer | Blob>
  readFileAsString(filePath: string): Promise<string>
  getFs(): Promise<any>
  getFsSync(): any
  getPathModule(): any
  getParentDirPath(filePath: string): string
  getFilenameFromPath(filePath: string): string
}
