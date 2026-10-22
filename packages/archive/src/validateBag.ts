import { decodeManifestPath, type Bag, type BagFile } from './bag'
import { BAG_ALGORITHMS, digestHex, fromUtf8, type BagAlgorithm } from './bytes'

export type BagValidation = {
  valid: boolean
  /** One line per problem, naming the file. Empty when `valid`. */
  errors: string[]
}

const MANIFEST = /^(tag)?manifest-([a-z0-9]+)\.txt$/

/** `label: value` pairs of a tag file, with indented continuation lines folded back in. */
const parseTagLines = (text: string): [string, string][] => {
  const entries: [string, string][] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line === '') continue
    const last = entries[entries.length - 1]
    if (/^\s/.test(line) && last) {
      last[1] += `\n${line.trim()}`
      continue
    }
    const colon = line.indexOf(':')
    if (colon > 0) entries.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()])
  }
  return entries
}

/**
 * Checks a bag the way a BagIt validator does: bagit.txt declares BagIt 1.0 (or 0.97) in UTF-8,
 * there is at least one payload manifest, every payload file is listed in every payload manifest
 * and matches it, every listed file exists, every tag manifest entry matches, and Payload-Oxum
 * (when present) agrees with the payload. Only SHA-256 and SHA-512 manifests are checked; a
 * manifest for another algorithm is reported as an error rather than skipped.
 */
export function validateBag(bag: Bag): BagValidation {
  const errors: string[] = []
  const byPath = new Map<string, BagFile>(bag.files.map((file) => [file.path, file]))
  const text = (path: string): string | undefined => {
    const file = byPath.get(path)
    if (!file) return undefined
    const decoded = fromUtf8(file.bytes)
    if (decoded === undefined) errors.push(`${path} is not valid UTF-8`)
    return decoded
  }

  const declaration = text('bagit.txt')
  if (declaration === undefined) {
    errors.push('bagit.txt is missing')
  } else {
    const fields = new Map(parseTagLines(declaration))
    const version = fields.get('BagIt-Version')
    if (version !== '1.0' && version !== '0.97') errors.push(`bagit.txt declares BagIt-Version ${version ?? '(none)'}`)
    if (fields.get('Tag-File-Character-Encoding')?.toUpperCase() !== 'UTF-8') {
      errors.push('bagit.txt does not declare Tag-File-Character-Encoding: UTF-8')
    }
  }

  const payloadPaths = bag.files.filter((f) => f.path.startsWith('data/')).map((f) => f.path)
  const manifests = bag.files
    .map((file) => ({ file, match: MANIFEST.exec(file.path) }))
    .filter((m): m is { file: BagFile; match: RegExpExecArray } => m.match !== null)

  if (!manifests.some(({ match }) => !match[1])) errors.push('no payload manifest (manifest-<algorithm>.txt)')

  for (const { file, match } of manifests) {
    const isTag = !!match[1]
    const algorithm = match[2] as string
    if (!(BAG_ALGORITHMS as readonly string[]).includes(algorithm)) {
      errors.push(`${file.path}: algorithm ${algorithm} is not supported by this validator`)
      continue
    }
    const body = text(file.path)
    if (body === undefined) continue
    const listed = new Set<string>()
    for (const line of body.split('\n')) {
      if (line.trim() === '') continue
      const parsed = /^([0-9a-fA-F]+)\s+(.+)$/.exec(line.replace(/\r$/, ''))
      if (!parsed) {
        errors.push(`${file.path}: malformed line ${JSON.stringify(line)}`)
        continue
      }
      const path = decodeManifestPath(parsed[2] as string)
      listed.add(path)
      if (!isTag && !path.startsWith('data/')) errors.push(`${file.path}: ${path} is outside data/`)
      const target = byPath.get(path)
      if (!target) {
        errors.push(`${file.path}: ${path} is listed but missing`)
      } else if (digestHex(algorithm as BagAlgorithm, target.bytes) !== (parsed[1] as string).toLowerCase()) {
        errors.push(`${file.path}: ${path} does not match its ${algorithm} checksum`)
      }
    }
    if (!isTag) {
      for (const path of payloadPaths) {
        if (!listed.has(path)) errors.push(`${file.path}: payload file ${path} is not listed`)
      }
    }
  }

  const info = text('bag-info.txt')
  const oxum = info !== undefined ? parseTagLines(info).find(([label]) => label === 'Payload-Oxum')?.[1] : undefined
  if (oxum !== undefined) {
    const octets = bag.files.filter((f) => f.path.startsWith('data/')).reduce((sum, f) => sum + f.bytes.byteLength, 0)
    if (oxum !== `${octets}.${payloadPaths.length}`) {
      errors.push(`bag-info.txt: Payload-Oxum ${oxum} does not match the payload (${octets}.${payloadPaths.length})`)
    }
  }

  return { valid: errors.length === 0, errors }
}
