import type { SeedLicenseTerms } from '../terms'

export type Domain = 'software' | 'media' | 'data' | 'ai-model' | 'font' | 'hardware' | 'news' | 'academic'

/**
 * A license as frozen data. `id` is `<slug>@<version>` and never changes meaning once released: a
 * change makes a new version. `toTerms` is pure and returns a new object on every call.
 */
export interface LicenseModule<P = void> {
  id: `${string}@${string}`
  spdx: string
  name: string
  shortName: string
  /** The license's IRI, for `dcterms:license` and `rel="license"`. Reserved rights uses its notice's URL. */
  iri?: string
  domains: readonly Domain[]
  steward: { name: string; url: string }
  legal: { canonicalUrl: string; sha256: string; lang: string }
  toTerms(...params: [P] extends [void] ? [] : [params: P]): SeedLicenseTerms
  stewardDeedUrl?: string
  warnings?: readonly ('irrevocable' | 'nc-ambiguity' | 'flow-down-restrictions')[]
}

export interface LicenseCatalog {
  /** Modules in the order given to `createLicenseCatalog`. */
  list(filter?: { domain?: Domain }): LicenseModule<any>[]
  get(id: string): LicenseModule<any> | undefined
  /** Exact match on the SPDX id as the module spells it. */
  bySpdx(spdx: string): LicenseModule<any> | undefined
  /** Modules with fixed terms only. */
  byTermsHash(hash: string): { module: LicenseModule<any>; terms: SeedLicenseTerms } | undefined
}
