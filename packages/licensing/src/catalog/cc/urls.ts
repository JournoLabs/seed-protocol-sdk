/** URLs of the Creative Commons modules, shared by the modules and by `fromUrl` in core. */
export const CC_CODES = ['by', 'by-sa', 'by-nc', 'by-nc-sa', 'by-nd', 'by-nc-nd'] as const
export type CcCode = (typeof CC_CODES)[number]

export const ccSpdx = (code: CcCode) => `CC-${code.toUpperCase()}-4.0`

export const ccUrls = (code: CcCode) => {
  const base = `https://creativecommons.org/licenses/${code}/4.0/`
  return { iri: base, canonicalUrl: `${base}legalcode.en`, stewardDeedUrl: `${base}deed.en` }
}

export const CC0_URLS = {
  iri: 'https://creativecommons.org/publicdomain/zero/1.0/',
  canonicalUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode.en',
  stewardDeedUrl: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en',
}

export const RESERVED_SPDX = 'LicenseRef-seed-all-rights-reserved-1'
export const RESERVED_URLS = {
  canonicalUrl:
    'https://github.com/JournoLabs/seed-protocol-sdk/blob/v0.8.2/packages/licensing/legal/LicenseRef-seed-all-rights-reserved-1.txt',
}

/** Every module URL (IRI and legal text) to the module's SPDX id. */
export function catalogUrlTable(): Map<string, string> {
  const table = new Map<string, string>()
  for (const code of CC_CODES) {
    const urls = ccUrls(code)
    table.set(urls.iri, ccSpdx(code))
    table.set(urls.canonicalUrl, ccSpdx(code))
  }
  table.set(CC0_URLS.iri, 'CC0-1.0')
  table.set(CC0_URLS.canonicalUrl, 'CC0-1.0')
  table.set(RESERVED_URLS.canonicalUrl, RESERVED_SPDX)
  return table
}
