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
  'archive',
  'eas',
  'arweave',
  'vite',
  'next',
  'query',
  'sdk',
  'feed',
  'feed-hyper',
  'gateway-hyper',
  'react',
  'publish',
  'mapping',
]

/**
 * Packages that have never been on npm. CI publishes with trusted publishing, which can't create
 * a package, so these stay out of PUBLISH_ORDER (publish, dist-tags, changelogs) until a
 * maintainer publishes them once by hand with `scripts/publish-package.js <name>` and adds their
 * trusted publishers (docs/RELEASING.md). Then move each one into PUBLISH_ORDER.
 */
export const AWAITING_FIRST_PUBLISH = []

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
 * Why `target` can't be released, given the committed version and what npm has
 * on `latest`. Empty when it can.
 * @param {{ target: string, committed: string, npmLatest?: string | null, published?: boolean }} input
 * @returns {string[]}
 */
export function releaseVersionProblems({ target, committed, npmLatest = null, published = false }) {
  if (!STABLE_RE.test(target)) {
    return [`Release versions must be plain X.Y.Z; got "${target}".`]
  }
  const problems = []
  if (STABLE_RE.test(committed) && compareStable(target, committed) <= 0) {
    problems.push(`${target} is not newer than the committed version ${committed}.`)
  }
  if (npmLatest && STABLE_RE.test(npmLatest) && compareStable(target, npmLatest) <= 0) {
    problems.push(`${target} is not newer than ${npmLatest} on npm \`latest\`.`)
  }
  if (published) {
    problems.push(`${target} is already on npm.`)
  }
  return problems
}

/**
 * Versions from release tags (vX.Y.Z); other tags are ignored.
 * @param {string[]} tags
 * @returns {string[]}
 */
function releaseTagVersions(tags) {
  return tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).map((t) => t.slice(1))
}

/**
 * Release tags older than `released` whose version is on npm for no package: a release that failed
 * before publishing and was skipped instead of retried. A version some packages have is left alone:
 * re-running its Release run publishes the rest.
 * @param {{ tags: string[], released: string, publishedVersions: Set<string> }} input
 * @returns {string[]} tags, oldest first
 */
export function unreleasedTags({ tags, released, publishedVersions }) {
  return releaseTagVersions(tags)
    .filter((v) => compareStable(v, released) < 0 && !publishedVersions.has(v))
    .sort(compareStable)
    .map((v) => `v${v}`)
}

/**
 * The newest release tag older than `released` whose version reached npm, or null.
 * The changelog starts here, so a skipped failed tag doesn't hide the changes it carried.
 * @param {{ tags: string[], released: string, publishedVersions: Set<string> }} input
 * @returns {string | null}
 */
export function previousReleasedTag({ tags, released, publishedVersions }) {
  const older = releaseTagVersions(tags)
    .filter((v) => compareStable(v, released) < 0 && publishedVersions.has(v))
    .sort(compareStable)
  return older.length > 0 ? `v${older[older.length - 1]}` : null
}

/**
 * Why the committed version's failed release can't be retried by moving its tag to HEAD.
 * Empty when it can.
 * @param {{
 *   version: string,
 *   tagCommit: string | null,
 *   tagInHead: boolean,
 *   publishedPackages: string[],
 *   tagRunState: string | null,
 * }} input - publishedPackages: packages that already have `version` on npm;
 *   tagRunState: the latest Release run for the tag (success, failure, in_progress, …), null if unknown
 * @returns {string[]}
 */
export function retryProblems({ version, tagCommit, tagInHead, publishedPackages, tagRunState }) {
  const tag = `v${version}`
  if (!tagCommit) {
    return [`There is no ${tag} on origin to retry; \`bun run release\` cuts the next version.`]
  }
  const problems = []
  if (publishedPackages.length === PUBLISH_ORDER.length) {
    problems.push(`${version} is already on npm for every package; there is nothing to retry.`)
  } else if (publishedPackages.length > 0) {
    // npm versions can't be replaced, so moving the tag would ship different code under one version.
    problems.push(
      `${version} is already on npm for ${publishedPackages.join(', ')}. Re-run ${tag}'s failed Release run ` +
        'instead: it skips published packages and publishes the rest from the same commit.',
    )
  }
  if (!tagInHead) {
    problems.push(`HEAD doesn't contain ${tag}'s commit ${tagCommit.slice(0, 7)}; retry from a commit after it.`)
  }
  if (tagRunState === 'in_progress' || tagRunState === 'queued' || tagRunState === 'waiting') {
    problems.push(`${tag}'s Release run is still ${tagRunState}; let it finish first.`)
  } else if (tagRunState === 'success') {
    problems.push(`${tag}'s Release run succeeded; there is nothing to retry.`)
  }
  return problems
}

/**
 * Every version of a package on the npm registry. Empty for a package that doesn't exist yet;
 * throws on any other failure, so a registry outage never reads as "not published".
 * @param {string} packageName - e.g. @seedprotocol/sdk
 * @returns {Promise<Set<string>>}
 */
export async function fetchPublishedVersions(packageName) {
  const res = await fetch(`https://registry.npmjs.org/${packageName.replace('/', '%2f')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (res.status === 404) return new Set()
  if (!res.ok) throw new Error(`npm registry returned ${res.status} for ${packageName}`)
  const body = await res.json()
  return new Set(Object.keys(body.versions ?? {}))
}

/**
 * Versions on npm for each package in PUBLISH_ORDER.
 * @returns {Promise<Map<string, Set<string>>>} package dir name → versions
 */
export async function fetchPublishedVersionsByPackage() {
  const entries = await Promise.all(
    PUBLISH_ORDER.map(async (dir) => [dir, await fetchPublishedVersions(`@seedprotocol/${dir}`)]),
  )
  return new Map(entries)
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
 * The commit a tag points at, from `git ls-remote --tags` output. Annotated tags
 * are peeled (`^{}`) to their commit.
 * @param {string} lsRemoteOutput
 * @param {string} tag - e.g. v0.7.2
 * @returns {string | null}
 */
export function tagCommitFromLsRemote(lsRemoteOutput, tag) {
  let direct = null
  for (const line of lsRemoteOutput.split('\n')) {
    if (!line) continue
    const [sha, ref] = line.split('\t')
    if (ref === `refs/tags/${tag}^{}`) return sha
    if (ref === `refs/tags/${tag}`) direct = sha
  }
  return direct
}

/**
 * The commit a tag on the remote points at right now, or null if there is no such tag.
 * @param {string} tag
 * @param {string} [remote]
 */
export function remoteTagCommit(tag, remote = 'origin') {
  return tagCommitFromLsRemote(git(['ls-remote', '--tags', remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`]), tag)
}

/**
 * Run npm. Returns stdout when `capture` is set, otherwise streams output.
 * `quiet` drops stderr, for expected failures the caller retries.
 * @param {string[]} args
 * @param {{ capture?: boolean, quiet?: boolean }} [options]
 */
export function npm(args, { capture = false, quiet = false } = {}) {
  const stderr = quiet ? 'ignore' : 'inherit'
  const output = execFileSync('npm', args, {
    encoding: 'utf-8',
    stdio: capture ? ['ignore', 'pipe', stderr] : ['inherit', 'inherit', stderr],
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

/**
 * Current dist-tags for a package from the registry's dist-tags endpoint, the one
 * `npm dist-tag` itself reads. Unlike the packument behind `npm view` (CDN-cached for
 * up to 5 minutes, and it lagged publishes by 3–8 minutes in v0.7.2 and #65), it
 * isn't served from the CDN cache, and it answers whether or not this version is
 * visible yet.
 * @param {string} packageName - e.g. @seedprotocol/sdk
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<Record<string, string>>}
 */
export async function fetchDistTags(packageName, fetchImpl = fetch) {
  const url = `https://registry.npmjs.org/-/package/${packageName.replace('/', '%2f')}/dist-tags`
  const res = await fetchImpl(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } })
  if (!res.ok) throw new Error(`npm registry returned ${res.status} for ${packageName} dist-tags`)
  const { _etag, ...tags } = await res.json()
  return tags
}

/**
 * Whether a release may move `latest` to `version`: only forward.
 * @param {string} version
 * @param {string | undefined} current - `latest` now
 * @returns {{ move: boolean, reason: string }}
 */
export function decideLatest(version, current) {
  if (!current) return { move: true, reason: 'no current latest' }
  if (compareStable(version, current) >= 0) return { move: true, reason: `current latest is ${current}` }
  return { move: false, reason: `latest is already newer (${current})` }
}

/**
 * Staging tags to remove from a package once its real tag points at `version`: this
 * run's own (named outright, since a lagging read may not show it yet) and any other
 * staging tag the read shows on `version`.
 * @param {{ tags: Record<string, string>, version: string, stagingTag?: string }} input
 * @returns {string[]}
 */
export function stagingTagsToRemove({ tags, version, stagingTag }) {
  const remove = new Set(stagingTag ? [stagingTag] : [])
  for (const [tag, tagged] of Object.entries(tags)) {
    if (tag.startsWith(STAGING_TAG_PREFIX) && tagged === version) remove.add(tag)
  }
  return [...remove]
}

/**
 * Call `fn` until it doesn't throw. Once another wait would pass `deadline`, the
 * last error is rethrown.
 * @template T
 * @param {(attempt: number) => T | Promise<T>} fn
 * @param {{
 *   deadline: number,
 *   intervalMs: number,
 *   onRetry?: (error: Error, attempt: number) => void,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} options
 * @returns {Promise<T>}
 */
export async function retryUntil(
  fn,
  {
    deadline,
    intervalMs,
    onRetry = () => {},
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      if (now() + intervalMs > deadline) throw error
      onRetry(error, attempt)
      await sleep(intervalMs)
    }
  }
}
