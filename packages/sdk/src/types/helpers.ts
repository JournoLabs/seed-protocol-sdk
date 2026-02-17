export type GetCorrectIdReturn = {
  localId?: string
  uid?: string
}

export type GetCorrectId = (localIdOrUid: string) => GetCorrectIdReturn
