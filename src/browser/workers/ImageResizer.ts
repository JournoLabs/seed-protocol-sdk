import imageResize from './imageResize'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager';
import debug from 'debug'

const logger = debug('seedSdk:browser:workers:ImageResizer')


export class ImageResizer {
  private cores: number
  private workersArchive: Map<string, Worker> = new Map()
  private workerBlobUrl: string

  constructor() {
    this.cores = Math.min(navigator.hardwareConcurrency || 4, 4);

    this.workerBlobUrl = globalThis.URL.createObjectURL(
      new Blob([imageResize], { type: 'application/javascript' })
    )
  }

    public async resize({filePath, width, height}: ResizeImageParams) {
      
    if (this.workersArchive.has(filePath)) {
      const savedWorker = this.workersArchive.get(filePath)
      savedWorker?.terminate()
      logger('[ImageResizer.resize] Terminated worker for filePath due to incoming request', filePath)
      this.workersArchive.delete(filePath)
    }

    const worker = new Worker(this.workerBlobUrl);

    this.workersArchive.set(filePath, worker)

    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        logger('[ImageResizer.resize] main thread onmessage', e.data);
        if (e.data.done) {
          const savedWorker = this.workersArchive.get(filePath)
          savedWorker?.terminate()
          logger('[ImageResizer.resize] Terminated worker for filePath due to done', filePath)
          this.workersArchive.delete(filePath)
          resolve(e.data)
        }

        if (e.data.error) {
          reject(e.data.error)
        }
      }
  
      worker.postMessage({
        filePath,
        width,
        height,
        debug: logger.enabled,
      });
    })
  }

  public async resizeAll({width, height}: ResizeAllImagesParams) {

    const fs = await BaseFileManager.getFs()

    const imageDir = '/files/images'
    let imageFilesStats = await fs.promises.readdir(imageDir, {
      withFileTypes: true
    })

    imageFilesStats = imageFilesStats.filter(file => file.isFile())

    const imageFiles = imageFilesStats.map(file => file.path)

    const widthDir = `${imageDir}/${width}`

    await BaseFileManager.createDirIfNotExists(widthDir)

    for (const imageFile of imageFiles) {
      const resizedImageExists = await BaseFileManager.pathExists(`${widthDir}/${imageFile}`)
      if (!resizedImageExists) {
        await this.resize({filePath: `${imageDir}/${imageFile}`, width, height})
      }
    }

  
  }
}
