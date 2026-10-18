// Defined in helpers/FileManager/IFileManager.ts; global aliases for code that uses them unimported.
type DownloadAllFilesParams = import('../helpers/FileManager/IFileManager').DownloadAllFilesParams
type DownloadAllFilesResult = import('../helpers/FileManager/IFileManager').DownloadAllFilesResult
type DownloadSingleFileParams = import('../helpers/FileManager/IFileManager').DownloadSingleFileParams

type ResizeAllImagesParams = {
  width: number,
  height: number
}

type ResizeImageParams = {
  filePath: string,
  width: number,
  height: number
}
