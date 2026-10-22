import { BAG_ALGORITHMS, digestHex, utf8 } from './bytes'
import { ArchiveError } from './errors'

/**
 * BagIt bags (RFC 8493, BagIt 1.0). A bag here is a list of files with bag-relative paths, so
 * the same value can be written to a directory (`@seedprotocol/archive/node`), zipped, or
 * uploaded file by file. Every bag carries SHA-256 and SHA-512 payload and tag manifests.
 */

/** One file of a bag. `path` is relative to the bag's base directory and uses `/`. */
export type BagFile = { path: string; bytes: Uint8Array }

/** A bag-info.txt line. Labels may repeat, and their order is kept. */
export type BagInfoEntry = [label: string, value: string]

export type Bag = { files: BagFile[] }

export type CreateBagOptions = {
  /** Payload files, with paths relative to `data/` (e.g. `index.html`, `assets/<sha256>.png`). */
  payload: BagFile[]
  /**
   * Tag files other than the ones the bag writes itself, with paths relative to the bag's base
   * (e.g. `metadata/dc.xml`). They are listed in the tag manifests.
   */
  tagFiles?: BagFile[]
  /** bag-info.txt entries. Bagging-Date, Payload-Oxum and Bag-Software-Agent are added when missing. */
  info?: BagInfoEntry[]
  /** Bagging-Date. Defaults to today (UTC). */
  baggingDate?: Date
  /** Bag-Software-Agent value. */
  softwareAgent?: string
}

export const BAGIT_VERSION = '1.0'
export const DEFAULT_SOFTWARE_AGENT = '@seedprotocol/archive (https://github.com/JournoLabs/seed-protocol-sdk)'

/** Tag files the bag writes itself; callers can't supply files at these paths. */
const RESERVED_TAG_PATH = /^(bagit\.txt|bag-info\.txt|fetch\.txt|(tag)?manifest-[a-z0-9]+\.txt)$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
const BAG_INFO_LABEL = /^[^\s:][^:\r\n]*$/

/**
 * Throws unless `path` is a portable bag-relative path: `/`-separated, no empty, `.` or `..`
 * segments, no backslash, control characters or `%`, and in Unicode NFC (two spellings of one
 * name would be different files on some file systems and the same file on others).
 *
 * `%` is refused because validators disagree on it: RFC 8493 writes it as `%25` in manifests,
 * and bagit-python 1.9.0 (the Library of Congress reference validator) doesn't decode `%25`, so
 * it reports the file as missing.
 */
export function assertBagPath(path: string): void {
  const problem =
    path === ''
      ? 'is empty'
      : path.startsWith('/')
        ? 'is absolute'
        : path.includes('\\')
          ? 'contains a backslash'
          : CONTROL_CHARACTER.test(path)
            ? 'contains a control character'
            : path.includes('%')
              ? 'contains "%"'
            : path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
              ? 'has an empty, "." or ".." segment'
              : path.normalize('NFC') !== path
                ? 'is not in Unicode NFC'
                : undefined
  if (problem) throw new ArchiveError('invalid_path', `Bag path ${JSON.stringify(path)} ${problem}`)
}

/** A manifest's filepath field: RFC 8493 §2.1.3 requires `%`, CR and LF percent-encoded. */
export const encodeManifestPath = (path: string): string =>
  path.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

export const decodeManifestPath = (field: string): string =>
  field.replace(/%0D/gi, '\r').replace(/%0A/gi, '\n').replace(/%25/g, '%')

const manifestText = (algorithm: (typeof BAG_ALGORITHMS)[number], files: BagFile[]): string =>
  files.map((file) => `${digestHex(algorithm, file.bytes)}  ${encodeManifestPath(file.path)}\n`).join('')

/** bag-info.txt: one `Label: value` line per entry, with line breaks in a value folded onto indented lines. */
const bagInfoText = (entries: BagInfoEntry[]): string =>
  entries
    .map(([label, value]) => {
      if (!BAG_INFO_LABEL.test(label)) {
        throw new ArchiveError('invalid_bag_info', `bag-info.txt label ${JSON.stringify(label)} is not valid`)
      }
      const folded = value.replace(/\r\n?/g, '\n').split('\n').join('\n  ')
      return `${label}: ${folded}\n`
    })
    .join('')

const isoDate = (date: Date): string => date.toISOString().slice(0, 10)

const byPath = (a: BagFile, b: BagFile): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * Builds a BagIt 1.0 bag: bagit.txt, bag-info.txt, SHA-256 and SHA-512 payload manifests, the
 * caller's tag files, and SHA-256 and SHA-512 tag manifests covering every tag file.
 *
 * Throws {@link ArchiveError} for a path that isn't portable ({@link assertBagPath}), a reserved
 * tag file name, a tag file under `data/`, or two files whose paths differ only in letter case
 * (they would collide on case-insensitive file systems).
 */
export function createBag(options: CreateBagOptions): Bag {
  const payload = options.payload.map((file) => {
    assertBagPath(file.path)
    return { path: `data/${file.path}`, bytes: file.bytes }
  })
  const extraTags = (options.tagFiles ?? []).map((file) => {
    assertBagPath(file.path)
    if (file.path.startsWith('data/') || RESERVED_TAG_PATH.test(file.path)) {
      throw new ArchiveError('invalid_path', `${file.path} can't be supplied as a tag file`)
    }
    return file
  })

  const seen = new Map<string, string>()
  for (const { path } of [...payload, ...extraTags]) {
    const key = path.toLowerCase()
    const previous = seen.get(key)
    if (previous !== undefined) {
      throw new ArchiveError(
        'duplicate_path',
        previous === path ? `${path} appears twice` : `${previous} and ${path} differ only in letter case`,
      )
    }
    seen.set(key, path)
  }
  payload.sort(byPath)
  extraTags.sort(byPath)

  const info = [...(options.info ?? [])]
  const has = (label: string) => info.some(([l]) => l.toLowerCase() === label.toLowerCase())
  if (!has('Bagging-Date')) info.push(['Bagging-Date', isoDate(options.baggingDate ?? new Date())])
  if (!has('Payload-Oxum')) {
    const octets = payload.reduce((sum, file) => sum + file.bytes.byteLength, 0)
    info.push(['Payload-Oxum', `${octets}.${payload.length}`])
  }
  if (!has('Bag-Software-Agent')) info.push(['Bag-Software-Agent', options.softwareAgent ?? DEFAULT_SOFTWARE_AGENT])

  const tagFiles: BagFile[] = [
    { path: 'bagit.txt', bytes: utf8(`BagIt-Version: ${BAGIT_VERSION}\nTag-File-Character-Encoding: UTF-8\n`) },
    { path: 'bag-info.txt', bytes: utf8(bagInfoText(info)) },
    ...BAG_ALGORITHMS.map((algorithm) => ({
      path: `manifest-${algorithm}.txt`,
      bytes: utf8(manifestText(algorithm, payload)),
    })),
    ...extraTags,
  ]
  const tagManifests = BAG_ALGORITHMS.map((algorithm) => ({
    path: `tagmanifest-${algorithm}.txt`,
    bytes: utf8(manifestText(algorithm, tagFiles)),
  }))

  return { files: [...tagFiles, ...tagManifests, ...payload] }
}

/** The bag's file at `path`, if any. */
export const getBagFile = (bag: Bag, path: string): BagFile | undefined => bag.files.find((f) => f.path === path)
