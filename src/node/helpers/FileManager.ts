import { promises as fs } from 'fs';
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager';

class FileManager extends BaseFileManager {
  static async readFileAsBuffer(filePath: string): Promise<Buffer> {
    return await fs.readFile(filePath);
  }

}

BaseFileManager.setPlatformClass(FileManager);

export { FileManager }; 