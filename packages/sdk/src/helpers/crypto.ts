import * as sha3 from 'js-sha3'

const { sha3_256 } = sha3

export const getContentHash = async (
  data: sha3.Message
): Promise<string> => {
  return sha3_256(data)
}

/**
 * Generate a deterministic ID from a seed string.
 * Same seed always produces the same id (first 10 hex chars of SHA3-256).
 * Used for schema/model/property IDs to prevent duplicates across runs.
 */
export const getDeterministicId = (seed: string): string => {
  return sha3_256(seed).slice(0, 10)
}