export type EasPropertyMetadata = {
  name: string
  value: string | string[]
  type?: string
}

export type ParseEasPropertyMetadataResult =
  | { ok: true; metadata: EasPropertyMetadata }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'shape' }
  | { ok: false; reason: 'parse'; error: unknown }

/**
 * Parse EAS property `decodedDataJson`.
 * Matches SDK guards in syncDbWithEas / saveDataToDb (empty trim, parse, array + [0].value).
 */
export function parseEasPropertyMetadata(
  decodedDataJson: string | undefined | null,
): ParseEasPropertyMetadataResult {
  const raw = typeof decodedDataJson === 'string' ? decodedDataJson.trim() : ''
  if (!raw) {
    return { ok: false, reason: 'empty' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, reason: 'parse', error: e }
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0]?.value) {
    return { ok: false, reason: 'shape' }
  }

  const metadata = parsed[0].value as EasPropertyMetadata
  return { ok: true, metadata }
}

/** @deprecated Use {@link parseEasPropertyMetadata} */
export const parseEasPropertyMetadataForFeed = parseEasPropertyMetadata
/** @deprecated Use {@link EasPropertyMetadata} */
export type EasPropertyMetadataForFeed = EasPropertyMetadata
/** @deprecated Use {@link ParseEasPropertyMetadataResult} */
export type ParseEasPropertyMetadataForFeedResult = ParseEasPropertyMetadataResult
