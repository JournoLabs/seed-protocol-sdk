/**
 * EAS lets any account attest with any `refUID`: it only checks that the referenced attestation
 * exists, and Seed's schemas have no resolver. So another account can attest a Version that
 * references someone's Seed, or a property that references someone's Version, and as the newest
 * attestation it would win the canonical pick.
 *
 * A Version counts only when its attester is the Seed's attester, and a property only when its
 * attester is the Version's. Attesters are compared case-insensitively. A child whose parent isn't
 * among `parents`, or where either attester is unknown (local drafts have none), is kept: there is
 * nothing to compare it with.
 */
export type RefAttesterParentLike = {
  id: string
  attester?: string | null
}

export type RefAttesterChildLike = {
  refUID?: string | null
  attester?: string | null
}

export function partitionByRefAttester<T extends RefAttesterChildLike>(
  children: T[],
  parents: Iterable<RefAttesterParentLike>,
): { kept: T[]; foreign: T[] } {
  const attesterByUid = new Map<string, string>()
  for (const parent of parents) {
    if (parent.attester) attesterByUid.set(parent.id, parent.attester.toLowerCase())
  }

  const kept: T[] = []
  const foreign: T[] = []
  for (const child of children) {
    const parentAttester = child.refUID ? attesterByUid.get(child.refUID) : undefined
    if (parentAttester && child.attester && child.attester.toLowerCase() !== parentAttester) {
      foreign.push(child)
    } else {
      kept.push(child)
    }
  }
  return { kept, foreign }
}

/** The `kept` half of {@link partitionByRefAttester}. */
export function keepAttestationsFromRefAttester<T extends RefAttesterChildLike>(
  children: T[],
  parents: Iterable<RefAttesterParentLike>,
): T[] {
  return partitionByRefAttester(children, parents).kept
}
