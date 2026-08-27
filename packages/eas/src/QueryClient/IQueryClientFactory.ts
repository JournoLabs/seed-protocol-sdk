import type { IQueryClient } from './IQueryClient.js'

export interface IQueryClientFactory {
  getQueryClient(): IQueryClient
}
