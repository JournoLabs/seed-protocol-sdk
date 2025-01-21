import path from "path";

type BrowserImageResizerConfigBase = {
	/**
	 * Algorithm used for downscaling
	 * 
	 * * `null`: Just resize with `drawImage()`. The best quality and fastest.
	 * * `bilinear`: Better quality, slower. Comes from upstream (ericnogralesbrowser-image-resizer).
	 * * `hermite`: Worse quality, faster. Comes from [viliusle/Hermite-resize](https://github.com/viliusle/Hermite-resize). Will dispatch workers for better performance.
	 * * `hermite_single`: Worse quality, faster. Single-threaded.
	 * 
	 * default: null
	 */
	algorithm: 'bilinear' | 'hermite' | 'hermite_single' | 'null' | null;

	/**
	 * Whether to process downscaling by `drawImage(source, 0, 0, source.width / 2, source.height / 2)`
	 * until the size is smaller than twice the target size.
	 *
	 * There seems to be no situation where it is necessary to change to false.
	 * 
	 * default: true
	 */
	processByHalf: boolean;

	maxWidth: number;
	maxHeight: number;
	maxSize?: number;     // ???

	/**
	 * Scale ratio. Strictly limited to maxWidth.
	 */
	scaleRatio?: number;

	/**
	 * Output logs to console
	 */
	debug: boolean;
}


type BrowserImageResizerConfigWithConvertedOutput = BrowserImageResizerConfigBase & {
	quality: number;
	mimeType: string;
};

type BrowserImageResizerConfigWithOffscreenCanvasOutput = BrowserImageResizerConfigBase & {
	mimeType: null;
}

type BrowserImageResizerConfig = BrowserImageResizerConfigWithConvertedOutput | BrowserImageResizerConfigWithOffscreenCanvasOutput;

type WorkerSouceData = {
  source: ImageData;
  startY: number;
  height: number;
}

export default `(
  ${
    function () {

async function listFilesInDirectory(directoryHandle: FileSystemDirectoryHandle) {
  const entries: { name: string; kind: FileSystemHandleKind }[] = [];

  for await (const [name, handle] of directoryHandle.entries()) {
      entries.push({
        name,
        kind: handle.kind,
      })
  }

  return entries;
}

const getFileHandle = async (path: string, rootHandle: FileSystemDirectoryHandle | null = null): Promise<FileSystemFileHandle> => {
    // Split the path into segments
    const segments = path.split('/').filter(Boolean);

    // Start from the root directory if not provided
    if (!rootHandle) {
        rootHandle = await navigator.storage.getDirectory();
    }

    let currentHandle = rootHandle;

    // Traverse the path segments
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isLastSegment = i === segments.length - 1;

        try {

          for await (const [name, handle] of currentHandle.entries()) {
            if (name !== segment) {
              continue
            }

            if (isLastSegment) {
                if (handle.kind === 'file') {
                    return handle as FileSystemFileHandle; // Return the file handle if found
                } else {
                    throw new Error(`Path '${path}' refers to a directory, not a file.`);
                }
            } else if (handle.kind === 'directory') {
                currentHandle = handle as FileSystemDirectoryHandle; // Traverse into the directory
            } else {
                throw new Error(`Invalid path segment '${segment}'`);
            }
          }
        } catch (err) {
            if (err instanceof Error && err.name === 'NotFoundError') {
                throw new Error(`Path '${path}' does not exist.`);
            } else {
                throw err;
            }
        }
    }

    throw new Error(`Path '${path}' could not be resolved.`);
}

async function getFileFromOPFS(path: string): Promise<File> {

  const fileHandleAsync = await getFileHandle(path);
  const file = await fileHandleAsync.getFile();
  return file;

}

const DEFAULT_CONFIG = {
	argorithm: 'null',
	processByHalf: true,
	quality: 0.5,
	maxWidth: 800,
	maxHeight: 600,
	debug: false,
	mimeType: 'image/jpeg',
} as const;

function isIos() {
	if (typeof navigator === 'undefined') return false;
	if (!navigator.userAgent) return false;
	return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

const getTargetHeight = (srcHeight: number, scale: number, config: BrowserImageResizerConfig) => {
	return Math.min(Math.floor(srcHeight * scale), config.maxHeight);
}

const findMaxWidth = (config: BrowserImageResizerConfig, canvas: { width: number; height: number }) => {
	//Let's find the max available width for scaled image
	const ratio = canvas.width / canvas.height;
	let mWidth = Math.min(
		canvas.width,
		config.maxWidth,
		ratio * config.maxHeight
	);
	if (
		config.maxSize &&
		config.maxSize > 0 &&
		config.maxSize < (canvas.width * canvas.height) / 1000
	)
		mWidth = Math.min(
			mWidth,
			Math.floor((config.maxSize * 1000) / canvas.height)
		);
	if (!!config.scaleRatio)
		mWidth = Math.min(mWidth, Math.floor(config.scaleRatio * canvas.width));

	const rHeight = getTargetHeight(canvas.height, mWidth / canvas.width, config);

  // console.log(
  //   'browser-image-resizer: original image size = ' +
  //   canvas.width +
  //   ' px (width) X ' +
  //   canvas.height +
  //   ' px (height)'
  // );
  // console.log(
  //   'browser-image-resizer: scaled image size = ' +
  //   mWidth +
  //   ' px (width) X ' +
  //   rHeight +
  //   ' px (height)'
  // );
	if (mWidth <= 0) {
		mWidth = 1;
		console.warn("browser-image-resizer: image size is too small");
	}

	if (isIos() && mWidth * rHeight > 167777216) {
		console.error("browser-image-resizer: image size is too large for iOS WebKit.", mWidth, rHeight);
		throw new Error("browser-image-resizer: image size is too large for iOS WebKit.");
	}

	return mWidth;
}

 /**
 * Hermite resize, multicore version - fast image resize/resample using Hermite filter.
 */
 const resample = (srcCanvas: OffscreenCanvas, destCanvas: OffscreenCanvas, config: { debug?: boolean }) => {
  return new Promise<void>((resolve, reject) => {

      const ratio_h = srcCanvas.height / destCanvas.height;
      const cores = Math.min(navigator.hardwareConcurrency || 4, 4)

      //prepare source and target data for workers
      const ctx = srcCanvas.getContext('2d');
      if (!ctx) return reject('Canvas is empty (resample)');

      const data_part: WorkerSouceData[] = [];
      const block_height = Math.ceil(srcCanvas.height / cores / 2) * 2;
      let end_y = -1;
      for (let c = 0; c < cores; c++) {
          //source
          const offset_y = end_y + 1;
          if (offset_y >= srcCanvas.height) {
              //size too small, nothing left for this core
              continue;
          }

          end_y = Math.min(offset_y + block_height - 1, srcCanvas.height - 1);

          const current_block_height = Math.min(block_height, srcCanvas.height - offset_y);

          console.log('browser-image-resizer: source split: ', '#' + c, offset_y, end_y, 'height: ' + current_block_height);

          data_part.push({
              source: ctx.getImageData(0, offset_y, srcCanvas.width, block_height),
              startY: Math.ceil(offset_y / ratio_h),
              height: current_block_height
          });
      }

      //start
      const destCtx = destCanvas.getContext('2d');
      if (!destCtx) return reject('Canvas is empty (resample dest)');
      let workers_in_use = data_part.length;
      for (let c = 0; c < data_part.length; c++) {

        //draw
        const height_part = Math.ceil(data_part[c].height / ratio_h);
        const target = destCtx.createImageData(destCanvas.width, height_part);
        // target.data.set(event.data.target);
        destCtx.putImageData(target, 0, data_part[c].startY);

      }
  });
};

  /**
   * Hermite resize - fast image resize/resample using Hermite filter. 1 cpu version!
   */
  const resampleSingle = (srcCanvasData: ImageData, destCanvasData: ImageData,) => {
    const ratio_w = srcCanvasData.width / destCanvasData.width;
    const ratio_h = srcCanvasData.height / destCanvasData.height;
    const ratio_w_half = Math.ceil(ratio_w / 2);
    const ratio_h_half = Math.ceil(ratio_h / 2);

    const data = srcCanvasData.data;
    const data2 = destCanvasData.data;

    for (let j = 0; j < destCanvasData.height; j++) {
        for (let i = 0; i < destCanvasData.width; i++) {
            const x2 = (i + j * destCanvasData.width) * 4;
            let weight = 0;
            let weights = 0;
            let weights_alpha = 0;
            let gx_r = 0;
            let gx_g = 0;
            let gx_b = 0;
            let gx_a = 0;
            const center_y = j * ratio_h;

            const xx_start = Math.floor(i * ratio_w);
            const xx_stop = Math.min(Math.ceil((i + 1) * ratio_w), srcCanvasData.width);
            const yy_start = Math.floor(j * ratio_h);
            const yy_stop = Math.min(Math.ceil((j + 1) * ratio_h), srcCanvasData.height);

            for (let yy = yy_start; yy < yy_stop; yy++) {
                let dy = Math.abs(center_y - yy) / ratio_h_half;
                let center_x = i * ratio_w;
                let w0 = dy * dy; //pre-calc part of w
                for (let xx = xx_start; xx < xx_stop; xx++) {
                    let dx = Math.abs(center_x - xx) / ratio_w_half;
                    let w = Math.sqrt(w0 + dx * dx);
                    if (w >= 1) {
                        //pixel too far
                        continue;
                    }
                    //hermite filter
                    weight = 2 * w * w * w - 3 * w * w + 1;
                    let pos_x = 4 * (xx + yy * srcCanvasData.width);
                    //alpha
                    gx_a += weight * data[pos_x + 3];
                    weights_alpha += weight;
                    //colors
                    if (data[pos_x + 3] < 255)
                        weight = weight * data[pos_x + 3] / 250;
                    gx_r += weight * data[pos_x];
                    gx_g += weight * data[pos_x + 1];
                    gx_b += weight * data[pos_x + 2];
                    weights += weight;
                }
            }
            data2[x2] = gx_r / weights;
            data2[x2 + 1] = gx_g / weights;
            data2[x2 + 2] = gx_b / weights;
            data2[x2 + 3] = gx_a / weights_alpha;
        }
    }
};

 /**
 * Hermite resize. Detect cpu count and use best option for user.
 */
 const resampleAuto = (srcCanvas: OffscreenCanvas, destCanvas: OffscreenCanvas, config: { debug?: boolean, argorithm?: string }) => {
  if (!!globalThis.Worker && navigator.hardwareConcurrency > 1 && config?.argorithm !== 'hermite_single') {
      //workers supported and we have at least 2 cpu cores - using multithreading
      return resample(srcCanvas, destCanvas, config);
  } else {
      //1 cpu version
      const { srcImgData, destImgData } = getImageData(srcCanvas, destCanvas);
      resampleSingle(srcImgData, destImgData, config);
      destCanvas.getContext('2d')!.putImageData(destImgData, 0, 0);
      return;
  }
};


async function scaleCanvasWithAlgorithm(canvas: OffscreenCanvas, config: BrowserImageResizerConfig & { outputWidth: number }) {
	const scale = config.outputWidth / canvas.width;

	const scaled = new OffscreenCanvas(Math.floor(config.outputWidth), getTargetHeight(canvas.height, scale, config));

	switch (config.algorithm) {
		case 'hermite': {
			await resampleAuto(canvas, scaled, config as BrowserImageResizerConfig & { algorithm: 'hermite' | 'hermite_single' });
			break;
		} case 'hermite_single': {
			const { srcImgData, destImgData } = getImageData(canvas, scaled);
			resampleSingle(srcImgData, destImgData,);
			scaled?.getContext('2d')?.putImageData(destImgData, 0, 0);
			break;
		} case 'bilinear': {
			// const { srcImgData, destImgData } = getImageData(canvas, scaled);
			// bilinear(srcImgData, destImgData, scale);
			// scaled?.getContext('2d')?.putImageData(destImgData, 0, 0);
			break;
		} default: {
			scaled.getContext('2d')?.drawImage(canvas, 0, 0, scaled.width, scaled.height);
			break;
		}
	}

	return scaled;
}

const getHalfScaleCanvas = (src: OffscreenCanvas | HTMLCanvasElement) => {
	const half = new OffscreenCanvas(src.width / 2, src.height / 2);

	half
		?.getContext('2d')
		?.drawImage(src, 0, 0, half.width, half.height);

	return half;
}

const getImageData = (canvas: OffscreenCanvas, scaled: OffscreenCanvas) => {
	const srcImgData = canvas
		?.getContext('2d')
		?.getImageData(0, 0, canvas.width, canvas.height);
	const destImgData = scaled
		?.getContext('2d')
		?.createImageData(scaled.width, scaled.height);

	if (!srcImgData || !destImgData) throw Error('Canvas is empty (scaleCanvasWithAlgorithm). You should run this script after the document is ready.');

	return { srcImgData, destImgData };
}

async function saveBlobToOPFS(filePath: string, blob: Blob): Promise<void> {
  // Access the OPFS root directory
  const rootHandle = await navigator.storage.getDirectory();

  // Split the filePath into directory segments and file name
  const segments = filePath.split('/').filter(Boolean);
  const fileName = segments.pop(); // Extract the file name
  if (!fileName) {
      throw new Error('Invalid file path: No file name provided.');
  }

  // Traverse or create directories as needed
  let currentDirHandle = rootHandle;
  for (const segment of segments) {
      currentDirHandle = await currentDirHandle.getDirectoryHandle(segment, { create: true });
  }

  // Create or open the file in OPFS
  const fileHandle = await currentDirHandle.getFileHandle(fileName, { create: true });

  // Write the Blob to the file
  const writableStream = await fileHandle.createWritable();
  await writableStream.write(blob);
  await writableStream.close();
}


const imageResize = async (filePath: string, width: number, height: number) => {

  console.log({filePath, width, height})

  const config = {
    ...DEFAULT_CONFIG,
    algorithm: 'hermite_single',
    mimeType: 'image/webp',
    maxWidth: width,
    maxHeight: height,
  }

  const rootHandle = await navigator.storage.getDirectory();

  // List files in the root directory
  const files = await listFilesInDirectory(rootHandle);
  console.log({
    message: 'listFilesInDirectory',
    files
  });

  const file = await getFileFromOPFS(filePath);

  const imageBitmap = await createImageBitmap(file);

  let converting: OffscreenCanvas

  if (isIos() && imageBitmap.width * imageBitmap.height > 16777216) {
    const scale = Math.sqrt(16777216 / (imageBitmap.width * imageBitmap.height));
    console.log(`browser-image-resizer: scale: Image is too large in iOS WebKit`);
    converting = new OffscreenCanvas(Math.floor(imageBitmap.width * scale), Math.floor(imageBitmap.height * scale));
    converting.getContext('2d')?.drawImage(imageBitmap, 0, 0, converting.width, converting.height);
  } else {
    converting = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    converting.getContext('2d')?.drawImage(imageBitmap, 0, 0);
  }

  if (!converting?.getContext('2d')) {
    console.log('browser-image-resizer: Canvas Context is empty.')
  }

  const maxWidth = findMaxWidth(config, converting);

	if (!maxWidth){ 
    throw Error(`browser-image-resizer: maxWidth is ${maxWidth}!!`)
  };

	while (config.processByHalf && converting.width >= 2 * maxWidth) {
		if (config.debug) console.log(`browser-image-resizer: scale: Scaling canvas by half from ${converting.width}`);
		converting = getHalfScaleCanvas(converting);
	}

	if (converting.width > maxWidth) {
		if (config.debug) console.log(`browser-image-resizer: scale: Scaling canvas by ${config.argorithm} from ${converting.width} to ${maxWidth}`);
		converting = await scaleCanvasWithAlgorithm(
			converting,
			Object.assign(config, { outputWidth: maxWidth }),
		);
	}

	if (config.mimeType === null) {
		return converting;
	}
	const resizedBlob = await converting.convertToBlob({ type: config.mimeType, quality: config.quality });

  const pathSegments = filePath.split('/');
  const fileName = pathSegments.pop();
  if (!fileName) {
    throw Error('Invalid file path: No file name provided.');
  }
  const newSegments = [
    ...pathSegments,
    width,
  ]
  const fileNameParts = fileName.split('.')
  const newFileName = `${fileNameParts[0]}.webp`
  const newDirPath = newSegments.join('/');
  const newFilePath = `${newDirPath}/${newFileName}`;

  // Save resized image to OPFS with new name
  await saveBlobToOPFS(newFilePath, resizedBlob)
  globalThis.postMessage({
    done: true,
    filePath: newFilePath,
  })

}

onmessage = async (e) => {
  console.log('[imageResize] onmessage', e.data)
  const { filePath, width, height } = e.data
  await imageResize(filePath, width, height)
  console.log(`[imageResize] Done`, filePath)
}
}.toString()
}
)()`
