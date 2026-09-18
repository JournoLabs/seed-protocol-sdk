import type { FieldMapping, SourceNode, TargetProperty } from './types'

const FULL_DOC_PROP_NAMES = ['text', 'content', 'body', 'fulltext', 'markdown']

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '').replace(/[:_-]/g, '')
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  return na === nb || na.includes(nb) || nb.includes(na)
}

/**
 * Sources that fan out to every unused target matching any alias.
 * Keys are normalized source label/id fragments.
 */
const FAN_OUT_ALIASES: Record<string, string[]> = {
  link: ['importurl', 'canonicalurl', 'url', 'link', 'permalink'],
  url: ['importurl', 'canonicalurl', 'url', 'link', 'permalink'],
}

function fanOutAliasesForSource(source: SourceNode): string[] | undefined {
  const labelKey = normalizeName(source.label)
  const idKey = normalizeName(source.id.replace(/^rss-/, '').replace(/^fm-/, ''))
  return FAN_OUT_ALIASES[labelKey] ?? FAN_OUT_ALIASES[idKey]
}

/**
 * Heuristic auto-map: full-document sources to body-like props,
 * then fuzzy name match for remaining sources ↔ targets.
 * Most sources map 1:1. Known URL fields (`link` / `url`) fan out to every
 * unused matching URL-ish property. Each property is used at most once.
 */
export function autoMap(
  sources: SourceNode[],
  targets: TargetProperty[],
): FieldMapping[] {
  const mappings: FieldMapping[] = []
  const usedProps = new Set<string>()
  const usedSources = new Set<string>()

  const fullSource = sources.find((s) => s.kind === 'full')
  if (fullSource) {
    const fullDocMatch = targets.find((p) =>
      FULL_DOC_PROP_NAMES.includes(p.name.toLowerCase()),
    )
    if (fullDocMatch) {
      mappings.push({
        sourceId: fullSource.id,
        propertyName: fullDocMatch.name,
      })
      usedProps.add(fullDocMatch.name)
      usedSources.add(fullSource.id)
    }
  }

  // Prefer common RSS aliases before generic fuzzy match
  const rssAliases: Record<string, string[]> = {
    title: ['title', 'name', 'headline'],
    'content:encoded': ['html', 'content', 'body', 'text'],
    content: ['html', 'content', 'body', 'text'],
    description: ['summary', 'description', 'excerpt'],
    summary: ['summary', 'description', 'excerpt'],
    featureimage: ['featureimage', 'feature_image', 'image', 'cover'],
    feature_image: ['featureimage', 'feature_image', 'image', 'cover'],
    link: ['url', 'link', 'permalink'],
    creator: ['author', 'authors', 'creator', 'byline'],
    author: ['author', 'authors', 'creator', 'byline'],
  }

  for (const source of sources) {
    if (usedSources.has(source.id)) continue

    const fanOutAliases = fanOutAliasesForSource(source)
    if (fanOutAliases) {
      for (const target of targets) {
        if (usedProps.has(target.name)) continue
        const matches = fanOutAliases.some((alias) =>
          namesMatch(target.name, alias),
        )
        if (matches) {
          mappings.push({ sourceId: source.id, propertyName: target.name })
          usedProps.add(target.name)
        }
      }
      continue
    }

    const labelKey = normalizeName(source.label)
    const idKey = source.id.replace(/^rss-/, '').replace(/^fm-/, '')
    const aliasKeys = [
      ...(rssAliases[source.label] ?? []),
      ...(rssAliases[idKey] ?? []),
      ...(rssAliases[labelKey] ?? []),
    ]

    let match: TargetProperty | undefined

    for (const alias of aliasKeys) {
      match = targets.find(
        (p) => !usedProps.has(p.name) && namesMatch(p.name, alias),
      )
      if (match) break
    }

    if (!match) {
      match = targets.find(
        (p) =>
          !usedProps.has(p.name) &&
          (namesMatch(p.name, source.label) || namesMatch(p.name, idKey)),
      )
    }

    if (match) {
      mappings.push({ sourceId: source.id, propertyName: match.name })
      usedProps.add(match.name)
      usedSources.add(source.id)
    }
  }

  return mappings
}
