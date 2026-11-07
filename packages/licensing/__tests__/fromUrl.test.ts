import { describe, expect, it } from 'vitest'
import { fromUrl } from '../src'
import { creativeCommons } from '../src/catalog/cc'

describe('fromUrl', () => {
  it.each([
    ['https://creativecommons.org/licenses/by/4.0/', 'CC-BY-4.0'],
    ['http://www.creativecommons.org/licenses/by-nc-sa/4.0', 'CC-BY-NC-SA-4.0'],
    ['https://creativecommons.org/licenses/by-nd/4.0/deed.de', 'CC-BY-ND-4.0'],
    ['https://creativecommons.org/licenses/by-nc/4.0/legalcode.en', 'CC-BY-NC-4.0'],
    ['https://creativecommons.org/licenses/by-nc/4.0/legalcode', 'CC-BY-NC-4.0'],
    ['https://creativecommons.org/licenses/by/4.0/?ref=rss', 'CC-BY-4.0'],
    ['https://creativecommons.org/licenses/by/4.0/#x', 'CC-BY-4.0'],
    ['https://creativecommons.org/licenses/by/3.0/', 'CC-BY-3.0'],
    ['https://creativecommons.org/licenses/by-nc-sa/3.0/de/', 'CC-BY-NC-SA-3.0-DE'],
    ['https://creativecommons.org/licenses/by-nc-sa/3.0/de/deed.en', 'CC-BY-NC-SA-3.0-DE'],
    ['https://creativecommons.org/licenses/by/3.0/igo/', 'CC-BY-3.0-IGO'],
    ['https://creativecommons.org/licenses/by-nc-sa/3.0/igo/deed.en', 'CC-BY-NC-SA-3.0-IGO'],
    ['https://creativecommons.org/publicdomain/zero/1.0/', 'CC0-1.0'],
    ['https://creativecommons.org/publicdomain/zero/1.0/legalcode', 'CC0-1.0'],
    ['https://spdx.org/licenses/MIT.html', 'MIT'],
    ['https://spdx.org/licenses/Apache-2.0.json', 'Apache-2.0'],
    ['https://spdx.org/licenses/CC-BY-4.0', 'CC-BY-4.0'],
    ['HTTPS://CreativeCommons.org/licenses/BY/4.0/', 'CC-BY-4.0'],
    ['  https://creativecommons.org/licenses/by/4.0/  ', 'CC-BY-4.0'],
  ])('%s → %s', (url, spdx) => expect(fromUrl(url)).toBe(spdx))

  it('resolves every catalog module URL', () => {
    for (const m of creativeCommons) {
      expect(fromUrl(m.legal.canonicalUrl), m.id).toBe(m.spdx)
      if (m.iri) expect(fromUrl(m.iri), m.id).toBe(m.spdx)
    }
  })

  it.each([
    'https://creativecommons.org/publicdomain/mark/1.0/',
    'https://creativecommons.org/licenses/by/9.9/',
    'https://creativecommons.org/licenses/by-nc-sa/3.0/xx/',
    'https://creativecommons.org/licenses/',
    'https://example.com/licenses/by/4.0/',
    'https://spdx.org/licenses/NOT-A-LICENSE.html',
    'ftp://creativecommons.org/licenses/by/4.0/',
    'not a url',
    '',
  ])('%s → null', (url) => expect(fromUrl(url)).toBeNull())
})
