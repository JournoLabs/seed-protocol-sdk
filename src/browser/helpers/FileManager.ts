import { BaseFileManager } from "@/helpers/FileManager/BaseFileManager";

class FileManager extends BaseFileManager {
  static async readFileAsBuffer(filePath: string): Promise<Buffer> {
    // Implement browser-specific logic
    return new Promise((resolve, reject) => {
      reject(new Error('Not implemented'));
    });
  }

  // Implement other methods
}

BaseFileManager.setPlatformClass(FileManager);

export { FileManager };
