import { BaseFileManager }     from '@/helpers/FileManager/BaseFileManager'
import { FileDownloader }      from '../workers/FileDownloader'
import { ImageResizer }        from '../workers/ImageResizer'

class FileManager extends BaseFileManager {
  static async readFileAsBuffer( filePath: string ): Promise<Buffer> {
    return new Promise(( resolve, reject ) => {
      reject(new Error('Not implemented'))
    })
  }

  static async getContentUrlFromPath( path: string ): Promise<string | undefined> {

    const fs = await import('@zenfs/core')

    const fileExists = await fs.promises.exists(
      path,
    )
    if ( fileExists ) {
      const fileContents = await fs.promises.readFile(
        path,
      )
      const fileHandler  = new File([ fileContents ], path)
      return URL.createObjectURL(fileHandler)
    }
  }

  static async initializeFileSystem(): Promise<void> {

    const {WebAccess} = await import('@zenfs/dom')
    const {configureSingle} = await import('@zenfs/core')

    const handle = await navigator.storage.getDirectory()
    // await configure({
    //   mounts: {
    //     '/': {
    //       backend: WebAccess,
    //       handle,
    //     },
    //   },
    //   disableUpdateOnRead: true,
    //   onlySyncOnClose: true,
    // })
    await configureSingle({
      backend: WebAccess,
      handle,
    })
  }

  static async downloadAllFiles( {
                                   transactionIds,
                                   arweaveHost,
                                   excludedTransactions,
                                 }: DownloadAllFilesParams ): Promise<void> {
    const fileDownloader = new FileDownloader()
    await fileDownloader.downloadAll({ transactionIds, arweaveHost, excludedTransactions })
  }

  static async resizeImage( { filePath, width, height }: ResizeImageParams ): Promise<void> {
    const imageResizer = new ImageResizer()
    await imageResizer.resize({ filePath, width, height })
  }

  static async resizeAllImages( { width, height }: ResizeAllImagesParams ): Promise<void> {
    const imageResizer = new ImageResizer()
    await imageResizer.resizeAll({ width, height })
  }
}

BaseFileManager.setPlatformClass(FileManager)

export { FileManager }
