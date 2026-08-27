export type DownloadAllFilesParams = {
  transactionIds: string[]
  arweaveHost: string
  excludedTransactions: Set<string>
}

export type DownloadSingleFileParams = {
  transactionId: string
  arweaveHost: string
  excludedTransactions: Set<string>
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
  downloadAllFiles(params: DownloadAllFilesParams): Promise<void>
  resizeImage(params: ResizeImageParams): Promise<void>
  resizeAllImages(params: ResizeAllImagesParams): Promise<void>
  pathExists(filePath: string): Promise<boolean>
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
