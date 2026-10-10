#!/usr/bin/env node
/**
 * Remove a deleted branch's dist-tag, and any staging tags its builds left
 * behind, from every public package. The versions themselves stay on npm.
 * See docs/RELEASING.md.
 *
 * Environment: DELETED_BRANCH, MAIN_BRANCH (default "main")
 *
 * Skips removal when another live branch cleans to the same dist-tag, since
 * the tag then belongs to that branch.
 */

import {
  PUBLISH_ORDER,
  STAGING_TAG_PREFIX,
  channelIdForBranch,
  getDistTags,
  listRemoteBranches,
  npmWrite,
} from './release-channel.js'

function main() {
  const branch = process.env.DELETED_BRANCH
  const mainBranch = process.env.MAIN_BRANCH || 'main'
  if (!branch) throw new Error('DELETED_BRANCH must be set')
  if (branch === mainBranch) {
    console.log(`[cleanup] ${branch} is the main branch; nothing to do`)
    return
  }

  const id = channelIdForBranch(branch, mainBranch)
  if (id === 'latest' || id === 'next') {
    throw new Error(`Refusing to remove reserved dist-tag "${id}"`)
  }

  const owners = [...listRemoteBranches().keys()].filter((b) => channelIdForBranch(b, mainBranch) === id)
  if (owners.length > 0) {
    console.log(`[cleanup] dist-tag "${id}" belongs to live branch ${owners.join(', ')}; leaving it`)
    return
  }

  // This branch's builds look like 0.6.11-<id>.<count>.g<sha>; ids are [0-9a-z-] only.
  const branchVersion = new RegExp(`^\\d+\\.\\d+\\.\\d+-${id}\\.\\d+\\.g[0-9a-f]{7}$`)
  for (const name of PUBLISH_ORDER) {
    const packageName = `@seedprotocol/${name}`
    const tags = getDistTags(packageName)
    for (const [tag, version] of Object.entries(tags)) {
      const isBranchTag = tag === id
      // Leftover staging tags from this branch's failed runs.
      const isStaleStaging = tag.startsWith(STAGING_TAG_PREFIX) && branchVersion.test(version)
      if (isBranchTag || isStaleStaging) {
        npmWrite(['dist-tag', 'rm', packageName, tag])
        console.log(`[cleanup] ${packageName}: removed ${tag} (${version})`)
      }
    }
  }
}

try {
  main()
} catch (error) {
  console.error(`[cleanup] ${error.message}`)
  process.exit(1)
}
