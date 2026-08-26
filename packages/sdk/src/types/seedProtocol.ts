import type { Attestation } from '@seedprotocol/eas'

export type PropertyToUpdateWithSeed = {
  publishLocalId: string
  propertySchemaUid: string
}

export type PublishRequestData = {
  localId: string
  seedIsRevocable: boolean
  seedSchemaUid: string
  seedUid?: string
  versionSchemaUid: string
  versionUid?: string
  propertiesToUpdate: PropertyToUpdateWithSeed[]
  listOfAttestations: Attestation[]
}
