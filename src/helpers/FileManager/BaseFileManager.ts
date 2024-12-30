export abstract class BaseFileManager {
  static PlatformClass: typeof BaseFileManager

  static setPlatformClass(platformClass: typeof BaseFileManager) {
    this.PlatformClass = platformClass
  }

  static getContentUrlFromPath(path: string): Promise<string | undefined> {
    return this.PlatformClass.getContentUrlFromPath(path)
  }
}
