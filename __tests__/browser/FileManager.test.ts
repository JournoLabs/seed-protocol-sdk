import { FileManager } from "@/browser/helpers/FileManager"
import { describe, it } from "vitest"

describe('FileManager in browser', () => {
  it('initialize for browser', () => {
    FileManager.initializeFileSystem()
  })
})
