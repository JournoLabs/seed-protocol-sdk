/**
 * Version and dist-tag rules for CI releases, shared by ci-version.js,
 * promote-dist-tag.js and cleanup-dist-tags.js. See docs/RELEASING.md.
 *
 * - Tag vX.Y.Z           → version X.Y.Z on `latest` (must match the committed version)
 * - Push to main          → {next patch}-next.{commit count}.g{sha7} on `next`
 * - Push to other branch  → {next patch}-{branch id}.{commit count}.g{sha7} on `{branch id}`
 *
 * The branch id is the branch name lowercased with anything outside [0-9a-z-]
 * changed to `-`. Names npm would reject or that would collide with a reserved
 * tag get a `branch-` prefix. The same id is used in the version and the tag.
 */

import { execFileSync } from 'child_process'

/**
 * Dependency-safe publish order for a full release.
 * Keep in sync with real @seedprotocol/* package.json dependencies.
 */
export const PUBLISH_ORDER = [
  'eas',
  'arweave',
  'vite',
  'query',
  'sdk',
  'feed',
  'feed-hyper',
  'gateway-hyper',
  'react',
  'publish',
  'mapping',
]

/** Packages publish under this tag first; the real tag moves once all are published. */
export const STAGING_TAG_PREFIX = 'ci-'
export const BRANCH_TAG_PREFIX = 'branch-'
const RESERVED_TAGS = new Set(['latest', 'next'])

/** semver.org's reference regex */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
const STABLE_RE = /^(\d+)\.(\d+)\.(\d+)$/
const SHA_RE = /^[0-9a-f]{40}$/

/**
 * @param {string} version
 */
export function isValidSemver(version) {
  return SEMVER_RE.test(version)
}

/**
 * @param {string} branch
 */
export function cleanBranchName(branch) {
  return branch.toLowerCase().replace(/[^0-9a-z-]/g, '-')
}

/**
 * npm rejects dist-tags that parse as a version or range (`v2`, `1`, `x`), and an
 * all-digit identifier with a leading zero (`007`) is invalid semver. Prefix
 * anything that starts like a version rather than enumerate npm's parser: any
 * number of leading `v`s followed by a digit or a lone `x`.
 * @param {string} name - cleaned branch name
 */
function needsPrefix(name) {
  return (
    RESERVED_TAGS.has(name) ||
    name.startsWith(STAGING_TAG_PREFIX) ||
    /^v*(\d|x(-|$))/.test(name)
  )
}

/**
 * The identifier used in both the prerelease version and the dist-tag.
 * @param {string} branch - raw branch name, e.g. `feature/Foo`
 * @param {string} [mainBranch]
 */
export function channelIdForBranch(branch, mainBranch = 'main') {
  if (branch === mainBranch) return 'next'
  const cleaned = cleanBranchName(branch)
  return needsPrefix(cleaned) ? `${BRANCH_TAG_PREFIX}${cleaned}` : cleaned
}

/**
 * Other live branches that would publish to the same dist-tag as `branch`.
 * @param {string} branch
 * @param {Iterable<string>} liveBranches
 * @param {string} [mainBranch]
 */
export function findCollidingBranches(branch, liveBranches, mainBranch = 'main') {
  const id = channelIdForBranch(branch, mainBranch)
  return [...liveBranches].filter(
    (other) => other !== branch && channelIdForBranch(other, mainBranch) === id,
  )
}

/**
 * @param {string} version - plain X.Y.Z
 */
export function nextPatch(version) {
  const match = version.match(STABLE_RE)
  if (!match) {
    throw new Error(
      `Committed version "${version}" is not plain X.Y.Z; prerelease versions are computed in CI and never committed.`,
    )
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

/**
 * Compare two plain X.Y.Z versions.
 * @returns {number} negative if a < b, 0 if equal, positive if a > b
 */
export function compareStable(a, b) {
  const pa = a.match(STABLE_RE)
  const pb = b.match(STABLE_RE)
  if (!pa || !pb) {
    throw new Error(`compareStable expects X.Y.Z versions; got "${a}" and "${b}"`)
  }
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i])
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * @param {string} sha - full commit SHA
 */
export function stagingTag(sha) {
  return `${STAGING_TAG_PREFIX}g${sha.slice(0, 7)}`
}

/**
 * Work out what a CI run publishes.
 * @param {{ ref: string, sha: string, baseVersion: string, commitCount?: number, mainBranch?: string }} input
 * @returns {{ channel: 'release' | 'preview', version: string, distTag: string, stagingTag: string, branch: string | null }}
 */
export function resolveRelease({ ref, sha, baseVersion, commitCount, mainBranch = 'main' }) {
  if (!SHA_RE.test(sha)) {
    throw new Error(`Expected a full 40-character commit SHA; got "${sha}"`)
  }

  if (ref.startsWith('refs/tags/')) {
    const tag = ref.slice('refs/tags/'.length)
    const version = tag.startsWith('v') ? tag.slice(1) : ''
    if (!STABLE_RE.test(version)) {
      throw new Error(`Release tags must look like vX.Y.Z; got "${tag}".`)
    }
    if (version !== baseVersion) {
      throw new Error(
        `Tag ${tag} does not match the committed version ${baseVersion} in packages/sdk/package.json. ` +
          `Run \`bun run new-version -- ${version}\`, commit, and tag that commit.`,
      )
    }
    return { channel: 'release', version, distTag: 'latest', stagingTag: stagingTag(sha), branch: null }
  }

  if (ref.startsWith('refs/heads/')) {
    const branch = ref.slice('refs/heads/'.length)
    if (!Number.isInteger(commitCount) || commitCount < 1) {
      throw new Error(`Expected a positive commit count; got ${commitCount}`)
    }
    const id = channelIdForBranch(branch, mainBranch)
    const version = `${nextPatch(baseVersion)}-${id}.${commitCount}.g${sha.slice(0, 7)}`
    if (!isValidSemver(version)) {
      throw new Error(`Computed version "${version}" is not valid semver`)
    }
    return { channel: 'preview', version, distTag: id, stagingTag: stagingTag(sha), branch }
  }

  throw new Error(`Unsupported ref "${ref}"; expected refs/heads/* or refs/tags/v*`)
}

/**
 * @param {string[]} args
 */
export function git(args) {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

/**
 * Branch heads on the remote right now, as name → SHA.
 * @param {string} [remote]
 * @returns {Map<string, string>}
 */
export function listRemoteBranches(remote = 'origin') {
  const heads = new Map()
  for (const line of git(['ls-remote', '--heads', remote]).split('\n')) {
    if (!line) continue
    const [sha, ref] = line.split('\t')
    heads.set(ref.slice('refs/heads/'.length), sha)
  }
  return heads
}

/**
 * Run npm. Returns stdout when `capture` is set, otherwise streams output.
 * @param {string[]} args
 * @param {{ capture?: boolean }} [options]
 */
export function npm(args, { capture = false } = {}) {
  const output = execFileSync('npm', args, {
    encoding: 'utf-8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
  return capture ? output.trim() : ''
}

/**
 * Run an npm command that changes the registry. With RELEASE_DRY_RUN=1 it is
 * printed instead, so promote/cleanup can be tried locally against real tags.
 * @param {string[]} args
 */
export function npmWrite(args) {
  if (process.env.RELEASE_DRY_RUN === '1') {
    console.log(`[dry run] npm ${args.join(' ')}`)
    return
  }
  npm(args)
}

/**
 * Current dist-tags for a package, read fresh from the registry.
 * @param {string} packageName - e.g. @seedprotocol/sdk
 * @returns {Record<string, string>}
 */
export function getDistTags(packageName) {
  return JSON.parse(npm(['view', packageName, 'dist-tags', '--json', '--prefer-online'], { capture: true }))
}
