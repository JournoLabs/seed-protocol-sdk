import { saveAppState } from '@/db/write/saveAppState.js';
import filesDownload from './filesDownload.js'



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

  public downloadAll = async ({transactionIds, arweaveHost, excludedTransactions}: DownloadAllFilesParams): Promise<void> => {

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

    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        console.log('filesDownload main thread onmessage', e.data);

        if (e.data.message === 'excludeTransaction') {
          localExcludedTransactions.add(e.data.transactionId)
        }

        if (e.data.done) {
          saveAppState('excludedTransactions', JSON.stringify(Array.from(localExcludedTransactions)))
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
      });
    })
  }
}
