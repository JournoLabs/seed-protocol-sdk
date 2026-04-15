export type EasPropertyMetadataForFeed = {
  name: string;
  value: string | string[];
  type?: string;
};

export type ParseEasPropertyMetadataForFeedResult =
  | { ok: true; metadata: EasPropertyMetadataForFeed }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'shape' }
  | { ok: false; reason: 'parse'; error: unknown };

/**
 * Parse EAS property `decodedDataJson` for feed assembly.
 * Matches SDK guards in syncDbWithEas / saveDataToDb (empty trim, parse, array + [0].value).
 */
export function parseEasPropertyMetadataForFeed(
  decodedDataJson: string | undefined | null,
): ParseEasPropertyMetadataForFeedResult {
  const raw =
    typeof decodedDataJson === 'string' ? decodedDataJson.trim() : '';
  if (!raw) {
    return { ok: false, reason: 'empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: 'parse', error: e };
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0]?.value) {
    return { ok: false, reason: 'shape' };
  }

  const metadata = parsed[0].value as EasPropertyMetadataForFeed;
  return { ok: true, metadata };
}
