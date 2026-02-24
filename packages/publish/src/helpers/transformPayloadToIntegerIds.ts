/**
 * Transforms multiPublish payload from string-based localId/publishLocalId to integer indices
 * for gas-efficient contract comparison. Use when the contract expects uint256 localIdIndex
 * and publishLocalIdIndex instead of strings.
 */

export type RequestWithStringIds = {
  localId: string
  propertiesToUpdate?: Array<{ publishLocalId?: string; propertySchemaUid?: string; [k: string]: unknown }>
  [k: string]: unknown
}

export type RequestWithIntegerIds = Omit<RequestWithStringIds, 'localId' | 'propertiesToUpdate'> & {
  localIdIndex: bigint
  propertiesToUpdate?: Array<{
    publishLocalIdIndex: bigint
    propertySchemaUid?: string
    [k: string]: unknown
  }>
}

/**
 * Converts localId/publishLocalId strings to uint256 indices.
 * Each request's index is its position in the array (0-based).
 * Throws if any publishLocalId does not exist in the payload.
 */
export function transformPayloadToIntegerIds(
  requests: RequestWithStringIds[],
): RequestWithIntegerIds[] {
  const localIdToIndex = new Map<string, bigint>()
  for (let i = 0; i < requests.length; i++) {
    const localId = requests[i]?.localId
    if (localId != null) {
      localIdToIndex.set(localId, BigInt(i))
    }
  }

  return requests.map((req, i) => {
    const propertiesToUpdate = (req.propertiesToUpdate ?? []).map((pu) => {
      const publishLocalId = pu.publishLocalId
      const index = publishLocalId != null ? localIdToIndex.get(publishLocalId) : undefined
      if (publishLocalId != null && publishLocalId !== '' && index === undefined) {
        throw new Error(
          `publishLocalId "${publishLocalId}" not found in payload (valid localIds: ${Array.from(localIdToIndex.keys()).join(', ')})`,
        )
      }
      const { publishLocalId: _omit, ...rest } = pu
      return {
        ...rest,
        publishLocalIdIndex: index ?? BigInt(0),
      }
    })

    const { localId: _omitLocalId, ...rest } = req
    return {
      ...rest,
      localIdIndex: BigInt(i),
      propertiesToUpdate,
    } as RequestWithIntegerIds
  })
}

/**
 * Transforms propertiesToUpdate from publishLocalId (string) to publishIndex (uint256)
 * for the Executor contract, which expects publishIndex. Keeps localId as string.
 */
export function transformPayloadForExecutor<T extends RequestWithStringIds>(
  requests: T[],
): T[] {
  const localIdToIndex = new Map<string, bigint>()
  for (let i = 0; i < requests.length; i++) {
    const localId = requests[i]?.localId
    if (localId != null) {
      localIdToIndex.set(localId, BigInt(i))
    }
  }

  return requests.map((req) => {
    const propertiesToUpdate = (req.propertiesToUpdate ?? []).map((pu) => {
      const publishLocalId = pu.publishLocalId
      const index = publishLocalId != null ? localIdToIndex.get(publishLocalId) : undefined
      if (publishLocalId != null && publishLocalId !== '' && index === undefined) {
        throw new Error(
          `publishLocalId "${publishLocalId}" not found in payload (valid localIds: ${Array.from(localIdToIndex.keys()).join(', ')})`,
        )
      }
      const { publishLocalId: _omit, ...rest } = pu
      return {
        ...rest,
        publishIndex: index ?? BigInt(0),
      }
    })
    return { ...req, propertiesToUpdate } as T
  })
}
