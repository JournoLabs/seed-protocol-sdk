type DownloadAllFilesParams = {
  transactionIds: string[], 
  arweaveHost: string,
  excludedTransactions: Set<string>
}

type ResizeAllImagesParams = {
  width: number,
  height: number
}

type ResizeImageParams = {
  filePath: string,
  width: number,
  height: number
}