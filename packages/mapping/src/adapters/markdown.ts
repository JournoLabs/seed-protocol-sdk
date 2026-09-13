import type { SourceNode } from '../types'

export const SECTION_FULL_ID = 'section-full'

type FrontmatterField = {
  id: string
  key: string
  value: string
  valueType: 'string' | 'boolean' | 'array'
}

type ParsedMarkdown = {
  frontmatter: FrontmatterField[]
  body: string
}

type MarkdownSection = {
  id: string
  heading: string
  level: number
  content: string
}

/**
 * Parse YAML-like frontmatter (flat keys only) and body.
 * Mirrors desktop MarkdownMapper limits: no nested YAML.
 */
export function parseMarkdownWithFrontmatter(
  markdownContent: string,
): ParsedMarkdown {
  try {
    const match = markdownContent.match(
      /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/,
    )
    if (!match) return { frontmatter: [], body: markdownContent }

    const yamlBlock = match[1] ?? ''
    const body = (match[2] ?? '').trimStart()
    const frontmatter: FrontmatterField[] = []
    const data: Record<string, unknown> = {}

    for (const line of yamlBlock.split('\n')) {
      const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/)
      if (!keyMatch) continue

      const key = keyMatch[1]!
      const raw = keyMatch[2]!.trim()
      let val: unknown = raw

      if (raw === 'true') val = true
      else if (raw === 'false') val = false
      else if (raw === 'null' || raw === '') val = null
      else if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
          val = JSON.parse(raw.replace(/'/g, '"'))
        } catch {
          val = raw
            .slice(1, -1)
            .split(',')
            .map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''))
        }
      } else if (raw.startsWith('"') || raw.startsWith("'")) {
        val = raw.slice(1, -1).replace(/\\"/g, '"')
      }

      data[key] = val
    }

    for (const [key, val] of Object.entries(data)) {
      let valueType: 'string' | 'boolean' | 'array' = 'string'
      let value: string

      if (Array.isArray(val)) {
        valueType = 'array'
        value = val
          .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)))
          .join(', ')
      } else if (typeof val === 'boolean') {
        valueType = 'boolean'
        value = String(val)
      } else if (val != null && typeof val === 'object') {
        value = JSON.stringify(val)
      } else {
        value = val != null ? String(val) : ''
      }

      frontmatter.push({
        id: `fm-${key}`,
        key,
        value,
        valueType,
      })
    }

    return { frontmatter, body }
  } catch {
    return { frontmatter: [], body: markdownContent }
  }
}

/**
 * Split markdown body into H1/H2 sections (###+ ignored as section breaks).
 */
export function parseMarkdownSections(md: string): MarkdownSection[] {
  const lines = md.split('\n')
  const sections: MarkdownSection[] = []
  let current: MarkdownSection | null = null

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/)
    const h1Match = line.match(/^# (.+)/)

    if (h1Match) {
      if (current) sections.push(current)
      current = {
        id: `section-${sections.length}`,
        heading: h1Match[1]!,
        level: 1,
        content: '',
      }
    } else if (h2Match) {
      if (current) sections.push(current)
      current = {
        id: `section-${sections.length}`,
        heading: h2Match[1]!,
        level: 2,
        content: '',
      }
    } else if (current) {
      current.content += (current.content ? '\n' : '') + line
    }
  }
  if (current) sections.push(current)
  return sections
}

/**
 * Convert markdown into SourceNodes for FieldMapper / applyMapping.
 * Order: frontmatter fields, full document body, then H1/H2 sections.
 */
export function markdownToSources(markdown: string): SourceNode[] {
  const parsed = parseMarkdownWithFrontmatter(markdown)
  const sections = parseMarkdownSections(parsed.body)
  const sources: SourceNode[] = []

  for (const fm of parsed.frontmatter) {
    sources.push({
      id: fm.id,
      label: fm.key,
      kind: 'frontmatter',
      value: fm.value,
      meta: { valueType: fm.valueType },
    })
  }

  sources.push({
    id: SECTION_FULL_ID,
    label: 'Full document',
    kind: 'full',
    value: parsed.body,
  })

  for (const section of sections) {
    const value =
      section.content.trim().length > 0 ? section.content.trim() : section.heading
    sources.push({
      id: section.id,
      label: section.heading,
      kind: 'section',
      value,
      meta: { level: section.level },
    })
  }

  return sources
}
