/**
 * A license offer as a reader sees it onchain (ADR 0037), without the chain: the caller has already
 * kept only offers on the Seed's Versions from the Seed's attester.
 */
export type LicenseOfferRecord = {
  uid: string
  /** Unix seconds. */
  timeCreated: number
  /** Unix seconds; 0 when not revoked. */
  revocationTime: number
  termsHash: string
  spdx: string
  /** Arweave transaction id of the legal text, when the offer names one. */
  legalTxId?: string
}

/** The license in force: `offer`, or reserved rights from `since` when `revoked`. */
export type LicenseInForce = {
  offer: LicenseOfferRecord
  /** The offer was revoked, which reads as reserved rights from its revocation time. */
  revoked: boolean
  /** Unix seconds: when this offer, or its revocation, took effect. */
  since: number
}

type OfferEvent = { time: number; offer: LicenseOfferRecord; revocation: boolean }

/**
 * Offers and revocations in the order they take effect. In one second an offer comes before a
 * revocation, and offers come by uid: the indexer gives no order within a block, and every
 * reader has to pick the same one.
 */
function events(offers: readonly LicenseOfferRecord[]): OfferEvent[] {
  const all: OfferEvent[] = []
  for (const offer of offers) {
    all.push({ time: offer.timeCreated, offer, revocation: false })
    if (offer.revocationTime > 0) all.push({ time: offer.revocationTime, offer, revocation: true })
  }
  return all.sort(
    (a, b) =>
      a.time - b.time ||
      Number(a.revocation) - Number(b.revocation) ||
      (a.offer.uid < b.offer.uid ? -1 : a.offer.uid > b.offer.uid ? 1 : 0),
  )
}

/**
 * Every change of the license in force, oldest first. A revocation takes effect only while its
 * offer is in force: revoking an offer a later one already replaced changes nothing.
 */
export function licenseHistory(offers: readonly LicenseOfferRecord[]): LicenseInForce[] {
  const history: LicenseInForce[] = []
  for (const event of events(offers)) {
    const current = history.at(-1)
    if (event.revocation) {
      if (current && current.offer === event.offer && !current.revoked) {
        history.push({ offer: event.offer, revoked: true, since: event.time })
      }
    } else {
      history.push({ offer: event.offer, revoked: false, since: event.time })
    }
  }
  return history
}

/**
 * The license in force at `time` (unix seconds): the newest offer attested at or before it, read
 * as reserved rights from its revocation time if it was revoked by then. Null when no offer was
 * attested by then.
 * @throws RangeError when `time` isn't a finite number
 */
export function offerInForce(offers: readonly LicenseOfferRecord[], time: number): LicenseInForce | null {
  if (!Number.isFinite(time)) throw new RangeError(`time must be unix seconds, got ${time}`)
  return licenseHistory(offers).filter((entry) => entry.since <= time).at(-1) ?? null
}
