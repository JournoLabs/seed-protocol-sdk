import { initEasClient } from "@/helpers/EasClient"
import { initArweaveClient } from "@/helpers/ArweaveClient"
import { initQueryClient } from "@/helpers/QueryClient"
import { initFileManager } from "@/helpers/FileManager"
import { initDb } from "@/db/Db"
import { initItem } from "@/Item"
import { initItemProperty } from "@/ItemProperty"
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

    await initItem()
    await initItemProperty()
    await initEasClient()
    await initArweaveClient()
    await initQueryClient()
    await initFileManager()
    await initDb()

    this.isInitialized = true


  }
}
