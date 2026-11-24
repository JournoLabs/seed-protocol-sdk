import {
  getItemPropertiesFromEas,
  getItemVersionsFromEas,
  getLicenseOffersFromEas,
  getSeedsByUidsFromEas,
  type Attestation,
} from '@seedprotocol/eas'
import {
  createLicenseCatalog,
  licenseHistory,
  offerInForce,
  summarySentence,
  termsHash,
  type LicenseCatalog,
  type LicenseInForce,
} from '@seedprotocol/licensing'
import { creativeCommons } from '@seedprotocol/licensing/catalog/cc'
import { initializeQueryPlatform } from './bootstrap.js'
import { revokedBy } from './seedAtTime.js'

/** A license in force on a Seed (ADR 0039). */
export type License = {
  /** The SPDX id: the catalog module's, else the one the offer carries. */
  spdx: string
  /** The license's IRI, for `dcterms:license` and `rel="license"`; null when the catalog doesn't know the terms. */
  iri: string | null
  termsHash: string
  /** The offer in force, or the revoked offer when `revoked`. */
  offerUid: string
  /** Arweave transaction id of the legal text, when the offer names one. */
  legalTxId: string | null
  /** One-sentence summary in English; null when the catalog doesn't know the terms. */
  sentence: string | null
  /** The offer was revoked, which reads as reserved rights from `since`. */
  revoked: boolean
  /** Unix seconds: when this license took effect. */
  since: number
}

export type GetLicenseOptions = {
  seedUid: string
  /** The Version to read. Default the Seed's newest Version live at `asOf`. */
  versionUid?: string
  /** Unix seconds. Default now. */
  asOf?: number
  /** Resolves `termsHash` to a license. Default the Creative Commons catalog. */
  catalog?: LicenseCatalog
}

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

let defaultCatalog: LicenseCatalog | undefined
const ccCatalog = (): LicenseCatalog => (defaultCatalog ??= createLicenseCatalog(creativeCommons))

const RESERVED_SPDX = 'LicenseRef-seed-all-rights-reserved-1'

function resolveLicense(entry: LicenseInForce, catalog: LicenseCatalog): License {
  const { offer, revoked, since } = entry
  if (revoked) {
    const reserved = catalog.bySpdx(RESERVED_SPDX) ?? ccCatalog().bySpdx(RESERVED_SPDX)!
    const terms = reserved.toTerms()
    return {
      spdx: reserved.spdx,
      iri: reserved.iri ?? null,
      termsHash: termsHash(terms),
      offerUid: offer.uid,
      legalTxId: null,
      sentence: summarySentence(terms, { locale: 'en' }),
      revoked: true,
      since,
    }
  }
  const known = catalog.byTermsHash(offer.termsHash)
  return {
    spdx: known?.module.spdx ?? offer.spdx,
    iri: known?.module.iri ?? null,
    termsHash: offer.termsHash,
    offerUid: offer.uid,
    legalTxId: offer.legalTxId ?? null,
    sentence: known ? summarySentence(known.terms, { locale: 'en' }) : null,
    revoked: false,
    since,
  }
}

/** The seed and its attester's Versions, oldest first; undefined when EAS has no such seed. */
async function readSeedVersions(seedUid: string): Promise<{ seed: Attestation; versions: Attestation[] } | undefined> {
  await initializeQueryPlatform({ source: 'remote' })
  const uid = seedUid.trim().toLowerCase()
  const [seed] = await getSeedsByUidsFromEas({ uids: [uid], excludeRevoked: false })
  if (!seed || seed.id.toLowerCase() !== uid) return undefined
  const versions = (await getItemVersionsFromEas({ seedUids: [seed.id], excludeRevoked: false }))
    .filter((v) => sameAddress(v.attester, seed.attester))
    .sort((a, b) => a.timeCreated - b.timeCreated || a.id.localeCompare(b.id))
  return { seed, versions }
}

/**
 * The license in force for a pin `(versionUid, asOf)`, by ADR 0039's rule: the newest offer from
 * the Seed's attester, on any of its Versions, attested at or before the newest attestation the
 * pin shows (the Version's own and each property's current one as of `asOf`). A revoked offer
 * reads as reserved rights from its revocation time.
 *
 * Null when no offer was in force, or when EAS has no such Seed, no Version of it by `asOf`, or no
 * Version `versionUid` from the Seed's attester live at `asOf`. Reads EAS on every call and keeps no cache, so a
 * result is never reused after an offer changes. The EAS indexer lists attestations a little late,
 * so an offer made seconds earlier can be missing.
 * @throws RangeError when `asOf` isn't a finite number
 */
export async function getLicense(options: GetLicenseOptions): Promise<License | null> {
  const { seedUid, versionUid, asOf, catalog = ccCatalog() } = options
  if (asOf !== undefined && !Number.isFinite(asOf)) throw new RangeError(`asOf must be unix seconds, got ${asOf}`)
  const read = await readSeedVersions(seedUid)
  if (!read) return null
  const { seed, versions } = read
  const time = asOf ?? Number.POSITIVE_INFINITY
  const version = versionUid
    ? versions.find((v) => sameAddress(v.id, versionUid.trim()) && v.timeCreated <= time && !revokedBy(v, time))
    : versions.filter((v) => v.timeCreated <= time && !revokedBy(v, time)).at(-1)
  if (!version) return null

  // Anyone can attest with any refUID, so only the Version's attester counts.
  const shown = (await getItemPropertiesFromEas({ versionUids: [version.id], excludeRevoked: false })).filter(
    (p) => sameAddress(p.attester, version.attester) && p.timeCreated <= time && !revokedBy(p, time),
  )
  const contentTime = Math.max(version.timeCreated, ...shown.map((p) => p.timeCreated))

  const offers = await getLicenseOffersFromEas({ versionUids: versions.map((v) => v.id), attester: seed.attester })
  const inForce = offerInForce(offers, contentTime)
  return inForce ? resolveLicense(inForce, catalog) : null
}

/**
 * Every change of the license offered on a Seed, oldest first, by ADR 0039's rule. Each entry took
 * effect for content attested from its `since`. Empty when EAS has no such Seed or it has no offer.
 * Reads EAS on every call.
 */
export async function getLicenseHistory(
  seedUid: string,
  options: { catalog?: LicenseCatalog } = {},
): Promise<License[]> {
  const read = await readSeedVersions(seedUid)
  if (!read) return []
  const offers = await getLicenseOffersFromEas({ versionUids: read.versions.map((v) => v.id), attester: read.seed.attester })
  const catalog = options.catalog ?? ccCatalog()
  return licenseHistory(offers).map((entry) => resolveLicense(entry, catalog))
}
