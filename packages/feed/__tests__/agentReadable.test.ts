import { afterEach, describe, expect, it } from 'vitest'
import { setResolvedSeedGatewayEndpoints } from '@seedprotocol/arweave'
import type { SeedRecord } from '@seedprotocol/query'
import { htmlToMarkdown, itemMarkdown, llmsTxt, llmsTxtItemLinks } from '../src/agentReadable'

const TX = 'agentTx'.padEnd(43, 'a')
const SIDECAR = 'http://127.0.0.1:1984'
const ATTESTER = '0x1111111111111111111111111111111111111111'

function record(data: Record<string, unknown>, overrides: Partial<SeedRecord> = {}): SeedRecord {
  return {
    seedUid: '0xseed',
    schemaName: 'post',
    attester: ATTESTER,
    timeCreated: 1_763_000_000,
    versionUid: '0xversion',
    data: { seedUid: '0xseed', ...data },
    ...overrides,
  } as SeedRecord
}

/** The YAML front matter of `markdown` as key → raw value text. */
function frontMatter(markdown: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown)
  expect(match).not.toBeNull()
  const out: Record<string, string> = {}
  for (const line of match![1]!.split('\n')) {
    const colon = line.indexOf(':')
    if (colon > 0 && !line.startsWith(' ')) out[line.slice(0, colon)] = line.slice(colon + 2)
  }
  return out
}

describe('htmlToMarkdown', () => {
  it('converts headings, emphasis, links and lists', () => {
    const md = htmlToMarkdown(
      '<h2>Section</h2><p>Some <strong>bold</strong> and <em>soft</em> text, <a href="https://example.com/a">a link</a>.</p><ul><li>one</li><li>two</li></ul>',
    )
    expect(md).toBe('## Section\n\nSome **bold** and _soft_ text, [a link](https://example.com/a).\n\n-   one\n-   two')
  })

  it('replaces embedded data:image pictures with their alt text', () => {
    const base64 = 'iVBORw0KGgo'.repeat(200)
    const md = htmlToMarkdown(`<p>Before</p><img src="data:image/png;base64,${base64}" alt="A chart"><p>After</p>`)
    expect(md).not.toContain('base64')
    expect(md).toContain('[image: A chart]')
  })

  it('keeps images with a URL as Markdown images', () => {
    expect(htmlToMarkdown('<img src="https://example.com/p.jpg" alt="Photo">')).toBe('![Photo](https://example.com/p.jpg)')
  })

  it('keeps tables as HTML and drops scripts and styles', () => {
    const md = htmlToMarkdown(
      '<script>alert(1)</script><style>p{}</style><table><tr><td>a</td><td>b</td></tr></table>',
    )
    expect(md).not.toContain('alert')
    expect(md).not.toContain('p{}')
    expect(md).toContain('<table>')
    expect(md).toContain('<td>a</td>')
  })
})

describe('itemMarkdown', () => {
  afterEach(() => setResolvedSeedGatewayEndpoints(null))

  it('opens with front matter giving the item’s provenance', () => {
    const md = itemMarkdown(record({ title: 'A post', html: '<p>Body</p>' }), {
      url: 'https://news.example/a-post',
    })
    const fm = frontMatter(md)
    expect(fm.title).toBe('"A post"')
    expect(fm.seed_uid).toBe('"0xseed"')
    expect(fm.version_uid).toBe('"0xversion"')
    expect(fm.attester).toBe(`"${ATTESTER}"`)
    expect(fm.schema).toBe('"post"')
    expect(fm.published).toBe('"2025-11-13T02:13:20.000Z"')
    expect(fm.url).toBe('"https://news.example/a-post"')
    expect(md.endsWith('# A post\n\nBody\n')).toBe(true)
  })

  it('quotes front matter values so titles with colons and quotes stay one value', () => {
    const fm = frontMatter(itemMarkdown(record({ title: 'Update: "final" word\nsecond line' })))
    expect(JSON.parse(fm.title!)).toBe('Update: "final" word\nsecond line')
  })

  it('keeps a multi-line title on the heading line', () => {
    const md = itemMarkdown(record({ title: 'First line\n  second\tline', html: '<p>Body</p>' }))
    expect(md).toContain('\n---\n\n# First line second line\n\nBody\n')
  })

  it('lists a single author Relation like an authors array', () => {
    expect(itemMarkdown(record({ title: 'Post', author: { name: 'Ada Example' } }))).toContain('authors:\n  - "Ada Example"\n')
    expect(itemMarkdown(record({ title: 'Post', Author: 'Grace Example' }))).toContain('authors:\n  - "Grace Example"\n')
  })

  it('lists the item’s authors and the summary', () => {
    const md = itemMarkdown(
      record({
        title: 'Post',
        summary: 'What happened',
        authors: [{ name: 'Ada Example' }, { displayName: 'Grace Example' }],
        html: '<p>Body</p>',
      }),
    )
    expect(md).toContain('authors:\n  - "Ada Example"\n  - "Grace Example"\n')
    expect(frontMatter(md).summary).toBe('"What happened"')
  })

  it('gives the licence when the caller passes one', () => {
    const fm = frontMatter(
      itemMarkdown(record({ title: 'Post' }), {
        license: {
          name: 'CC-BY-4.0',
          url: 'https://creativecommons.org/licenses/by/4.0/',
          summary: 'Anyone may republish and adapt it with credit.',
        },
      }),
    )
    expect(fm.license).toBe('"CC-BY-4.0"')
    expect(fm.license_url).toBe('"https://creativecommons.org/licenses/by/4.0/"')
    expect(fm.license_summary).toBe('"Anyone may republish and adapt it with credit."')
  })

  it('leaves out fields it has no value for', () => {
    const fm = frontMatter(itemMarkdown(record({ title: 'Post' }, { attester: undefined })))
    expect(fm).not.toHaveProperty('attester')
    expect(fm).not.toHaveProperty('url')
    expect(fm).not.toHaveProperty('license')
  })

  it('puts Arweave links in the body on the public gateway', () => {
    setResolvedSeedGatewayEndpoints({
      mode: 'hyper',
      arweaveHost: '127.0.0.1:1984',
      arweaveProtocol: 'http',
      arweaveBaseUrl: SIDECAR,
      arweaveGraphqlUrl: `${SIDECAR}/graphql`,
      uploadApiBaseUrl: SIDECAR,
      activePath: 'hyper-sidecar',
      publicArweaveBaseUrl: 'https://arweave.net',
    })
    const md = itemMarkdown(record({ title: 'Post', html: `<p><img src="${SIDECAR}/raw/${TX}" alt="Pic"></p>` }))
    expect(md).toContain(`![Pic](https://arweave.net/raw/${TX})`)
    expect(md).not.toContain(SIDECAR)
  })

  it('keeps a plain-text body as it is', () => {
    expect(itemMarkdown(record({ title: 'Note', text: 'Just *text* here' }))).toContain('# Note\n\nJust *text* here\n')
  })

  it('titles an item with no title by its seed UID', () => {
    expect(itemMarkdown(record({}))).toContain('# 0xseed\n')
  })
})

describe('llmsTxt', () => {
  it('writes the llms.txt layout: title, summary, details, then link sections', () => {
    const txt = llmsTxt({
      title: 'Example News',
      description: 'Local reporting from Example County.',
      details: 'Every article is attested on Optimism with EAS and stored on Arweave.',
      sections: [
        {
          name: 'Articles',
          links: [{ title: 'A post', url: 'https://news.example/a-post.md', note: 'What happened' }],
        },
        { name: 'Feeds', links: [{ title: 'JSON Feed', url: 'https://news.example/feed.json' }] },
        { name: 'Archive', optional: true, links: [{ title: '2024', url: 'https://news.example/2024.md' }] },
      ],
    })
    expect(txt).toBe(
      [
        '# Example News',
        '',
        '> Local reporting from Example County.',
        '',
        'Every article is attested on Optimism with EAS and stored on Arweave.',
        '',
        '## Articles',
        '',
        '- [A post](https://news.example/a-post.md): What happened',
        '',
        '## Feeds',
        '',
        '- [JSON Feed](https://news.example/feed.json)',
        '',
        '## Optional',
        '',
        '- [2024](https://news.example/2024.md)',
        '',
      ].join('\n'),
    )
  })

  it('keeps each link on one line and escapes brackets in titles', () => {
    const txt = llmsTxt({
      title: 'Site',
      sections: [{ name: 'Items', links: [{ title: 'A [draft] title', url: 'https://s.example/x', note: 'line one\nline two' }] }],
    })
    expect(txt).toContain('- [A \\[draft\\] title](https://s.example/x): line one line two\n')
  })

  it('encodes spaces and parentheses in the link URL so the link stays whole', () => {
    const txt = llmsTxt({
      title: 'Site',
      sections: [{ name: 'Items', links: [{ title: 'Doc', url: 'https://s.example/a b/doc_(v2).md' }] }],
    })
    expect(txt).toContain('- [Doc](https://s.example/a%20b/doc_%28v2%29.md)\n')
  })

  it('omits a section with no links', () => {
    expect(llmsTxt({ title: 'Site', sections: [{ name: 'Empty', links: [] }] })).toBe('# Site\n')
  })
})

describe('llmsTxtItemLinks', () => {
  it('links each record by its title and summary at the URL the caller gives', () => {
    const links = llmsTxtItemLinks(
      [
        record({ title: 'First', summary: 'One' }, { seedUid: '0xa' }),
        record({}, { seedUid: '0xb' }),
      ],
      (r) => `https://news.example/${r.seedUid}.md`,
    )
    expect(links).toEqual([
      { title: 'First', url: 'https://news.example/0xa.md', note: 'One' },
      { title: '0xb', url: 'https://news.example/0xb.md' },
    ])
  })
})
