import { termsHash } from '../hash'
import { validateTerms } from '../validate'
import type { LicenseCatalog, LicenseModule } from './types'

/**
 * An index over the modules given. Throws on a duplicate id or SPDX id, and on a module whose terms
 * fail `validateTerms`, naming the module.
 */
export function createLicenseCatalog(modules: readonly LicenseModule<any>[]): LicenseCatalog {
  const byId = new Map<string, LicenseModule<any>>()
  const bySpdx = new Map<string, LicenseModule<any>>()
  const byHash = new Map<string, LicenseModule<any>>()

  for (const module of modules) {
    if (byId.has(module.id)) throw new Error(`Duplicate license module id ${module.id}`)
    if (bySpdx.has(module.spdx)) throw new Error(`Duplicate SPDX id ${module.spdx} (${module.id})`)
    byId.set(module.id, module)
    bySpdx.set(module.spdx, module)
    let terms: unknown
    try {
      terms = module.toTerms()
    } catch (error) {
      throw new Error(`License module ${module.id}: toTerms failed: ${(error as Error).message}`)
    }
    const result = validateTerms(terms)
    if (!result.ok) {
      throw new Error(`License module ${module.id} has invalid terms: ${result.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`)
    }
    byHash.set(termsHash(result.terms), module)
  }

  return {
    list: (filter) => (filter?.domain ? modules.filter((m) => m.domains.includes(filter.domain!)) : [...modules]),
    get: (id) => byId.get(id),
    bySpdx: (spdx) => bySpdx.get(spdx),
    byTermsHash: (hash) => {
      const module = byHash.get(hash.toLowerCase())
      return module ? { module, terms: module.toTerms() } : undefined
    },
  }
}
