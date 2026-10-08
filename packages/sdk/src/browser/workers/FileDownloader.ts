import { addExcludedTransactions } from '@/db/write/addExcludedTransactions';
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager';
import filesDownload from './filesDownload'
import { notifyFilesWrittenOutsideCache } from '@/helpers/tabEvents'
import debug from 'debug'

const logger = debug('seedSdk:browser:workers:FileDownloader')

export class FileDownloader {
  private cores: number
  private workersArchive: Worker[] = []
  private workerBlobUrl: string

  constructor() {
    this.cores = Math.min(navigator.hardwareConcurrency || 4, 4);

    this.workerBlobUrl = globalThis.URL.createObjectURL(
      new Blob([filesDownload], { type: 'application/javascript' })
    )
  }

  public downloadAll = async ({transactionIds, arweaveHost, arweaveBaseUrls, excludedTransactions}: DownloadAllFilesParams): Promise<void> => {

    if (this.workersArchive.length > 0) {
      for (let i = 0; i < this.workersArchive.length; i++) {
        this.workersArchive[i].terminate()
        delete this.workersArchive[i]
      }
      this.workersArchive = []
    }

    const worker = new Worker(this.workerBlobUrl);

    this.workersArchive.push(worker)

    const localExcludedTransactions = new Set(excludedTransactions)
    const savedPaths: string[] = []

    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        logger('filesDownload main thread onmessage', e.data);

        if (e.data.message === 'excludeTransaction') {
          localExcludedTransactions.add(e.data.transactionId)
        }

        if (e.data.message === 'fileSaved') {
          savedPaths.push(e.data.filePath)
        }

        if (e.data.done) {
          addExcludedTransactions(localExcludedTransactions)
          // The worker wrote to OPFS directly; refresh caches here and in other tabs.
          .then(() => notifyFilesWrittenOutsideCache(savedPaths))
          .then(() => {
            resolve(e.data)
          })
          .catch((error) => {
            reject(error)
          })
        }
        if (e.data.error) {
          reject(e.data.error)
        }
      }
  
      worker.postMessage({
        transactionIds,
        arweaveHost,
        arweaveBaseUrls,
        debug: logger.enabled,
        filesRoot: BaseFileManager.getWorkingDir(),
      });
    })
  }
}
