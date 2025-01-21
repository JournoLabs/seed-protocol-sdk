import { IQueryClient } from "@/interfaces/IQueryClient"

export abstract class BaseQueryClient {
  static PlatformClass: typeof BaseQueryClient

  static setPlatformClass(platformClass: typeof BaseQueryClient) {
    this.PlatformClass = platformClass
  }

  static getQueryClient(): IQueryClient {
    return this.PlatformClass.getQueryClient()
  }
} 