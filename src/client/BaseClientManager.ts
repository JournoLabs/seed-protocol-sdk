import { SeedConstructorOptions } from "@/types"


export abstract class BaseClientManager {
  static isInitialized = false
  constructor() {
  }

  static async init(options: SeedConstructorOptions): Promise<void> {
    if (this.isInitialized) {
      return
    }

    const { config, addresses } = options


    this.isInitialized = true


  }
}
