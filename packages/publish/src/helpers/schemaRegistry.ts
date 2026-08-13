import {
  readSchemaRecord,
  encodeRegisterSchema,
  type SchemaRecord,
} from './contracts'
import type { SeedTxRequest } from './seedSigner'

export type { SchemaRecord }

export type RegisterSchemaParams = {
  schema: string
  resolverAddress: string
  revocable: boolean
}

export async function getSchemaRecord(uid: string): Promise<SchemaRecord | null> {
  return readSchemaRecord(uid)
}

export function registerSchema(params: RegisterSchemaParams): SeedTxRequest {
  return encodeRegisterSchema(params)
}
