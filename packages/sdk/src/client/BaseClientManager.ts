import { SeedConstructorOptions } from "@/types"


export abstract class BaseClientManager {
  static isInitialized = false
  constructor() {
  }

  static async init(_options: SeedConstructorOptions): Promise<void> {
    if (this.isInitialized) {
      return
    }



    this.isInitialized = true


  }
}
