export declare abstract class BaseFileManager {
    private static fileSystemInitialized;
    private static initializing;
    private static workingDir;
    static PlatformClass: typeof BaseFileManager;
    static setPlatformClass(platformClass: typeof BaseFileManager): void;
    static initializeFileSystem(workingDir?: string): Promise<void>;
    static getWorkingDir(): string;
    /**
     * Build a path under the configured files root (e.g. /app-files).
     * Use this instead of hardcoding /files/ for images, html, json, etc.
     * @param subpaths - path segments to join (e.g. 'images', fileName)
     * @returns full path like /app-files/images/egg.jpg
     */
    static getFilesPath(...subpaths: string[]): string;
    static getContentUrlFromPath(path: string): Promise<string | undefined>;
    static downloadAllFiles({ transactionIds, arweaveHost, excludedTransactions, }: DownloadAllFilesParams): Promise<void>;
    static resizeImage({ filePath, width, height }: ResizeImageParams): Promise<void>;
    static resizeAllImages({ width, height }: ResizeAllImagesParams): Promise<void>;
    static pathExists(filePath: string): Promise<boolean>;
    /**
     * Returns a list of filenames in the given directory (e.g. 'images', 'files').
     */
    static listFiles(dir: string): Promise<string[]>;
    /**
     * Returns a list of image filenames in the images folder (originals only, excludes size subdirs).
     * Use this to get all stored images without traversing 480/760/1024/1440/1920 subdirectories.
     */
    static listImageFiles(): Promise<string[]>;
    static createDirIfNotExists(filePath: string): Promise<void>;
    static waitForFile(filePath: string): Promise<boolean>;
    static waitForFileWithContent(filePath: string, interval?: number, timeout?: number): Promise<boolean>;
    static saveFile(filePath: string, content: string | Blob | ArrayBuffer): Promise<void>;
    static saveFileSync(filePath: string, content: string | Blob | ArrayBuffer): void;
    static readFile(filePath: string): Promise<File>;
    static readFileSync(filePath: string): File;
    static readFileAsBuffer(filePath: string): Promise<Buffer | Blob>;
    static readFileAsString(filePath: string): Promise<string>;
    static getFs(): Promise<any>;
    static getFsSync(): any;
    static getPathModule(): any;
    static getParentDirPath(filePath: string): string;
    static getFilenameFromPath(filePath: string): string;
}
//# sourceMappingURL=BaseFileManager.d.ts.map