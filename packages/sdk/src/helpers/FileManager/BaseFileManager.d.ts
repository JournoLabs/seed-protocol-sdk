import type { IFileManager, DownloadAllFilesParams, DownloadSingleFileParams, ResizeAllImagesParams, ResizeImageParams } from './IFileManager';
export declare abstract class BaseFileManager {
    private static fileSystemInitialized;
    private static initializing;
    private static workingDir;
    private static _impl;
    static configure(impl: IFileManager): void;
    private static requireImpl;
    static initializeFileSystem(workingDir?: string): Promise<void>;
    static getWorkingDir(): string;
    /**
     * Build a path under the configured files root (e.g. /app-files).
     */
    static getFilesPath(...subpaths: string[]): string;
    static getContentUrlFromPath(path: string): Promise<string | undefined>;
    static downloadAllFiles({ transactionIds, arweaveHost, excludedTransactions, }: DownloadAllFilesParams): Promise<void>;
    static downloadFileByTransactionId({ transactionId, arweaveHost, excludedTransactions, }: DownloadSingleFileParams): Promise<void>;
    static resizeImage({ filePath, width, height }: ResizeImageParams): Promise<void>;
    static resizeAllImages({ width, height }: ResizeAllImagesParams): Promise<void>;
    static pathExists(filePath: string): Promise<boolean>;
    static listFiles(dir: string): Promise<string[]>;
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
