type DownloadAllFilesParams = {
  transactionIds: string[], 
  arweaveHost: string,
  /** Ordered read gateways (scheme + host + path) tried before `arweaveHost`; see `getArweaveReadBaseUrls`. */
  arweaveBaseUrls?: string[],
  excludedTransactions: Set<string>
}

type DownloadSingleFileParams = {
  transactionId: string,
  arweaveHost: string,
  /** Ordered read gateways (scheme + host + path) tried before `arweaveHost`; see `getArweaveReadBaseUrls`. */
  arweaveBaseUrls?: string[],
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
