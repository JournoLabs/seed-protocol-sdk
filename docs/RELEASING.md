# Releasing

All 11 public packages (`eas`, `arweave`, `vite`, `query`, `sdk`, `feed`,
`feed-hyper`, `gateway-hyper`, `react`, `publish`, `mapping`) publish from CI at one
shared version, with npm provenance, through npm trusted publishing. There is no npm
token. The decision is recorded in [ADR 0007](adr/0007-ci-publishing-and-branch-prereleases.md).

## Channels

| Trigger | Version | dist-tag | GitHub environment |
|---|---|---|---|
| Tag `vX.Y.Z` | `X.Y.Z` | `latest` | `release` |
| Push to `main` | `{next patch}-next.{count}.g{sha7}` | `next` | `preview` |
| Push to any other branch | `{next patch}-{branch id}.{count}.g{sha7}` | `{branch id}` | `preview` |

- **Next patch** is the committed `packages/sdk` version plus one patch. It never
  depends on what's on npm, so re-running a commit gives the same version.
- **Count** is `git rev-list --count <sha>`. It keeps prereleases in commit order.
  The `g` before the short SHA keeps the version valid when the SHA is all digits.
- **Branch id** is the branch name lowercased with anything outside `[0-9a-z-]`
  changed to `-`. Names that are reserved (`latest`, `next`), start with the staging
  prefix `ci-`, or that npm could read as a version (`007`, `v2`, `x`) get a `branch-`
  prefix. The same id goes in the version and the tag.
- Prerelease versions are stamped in CI and **never committed**.

Pushes that only change `docs/**` or `*.md` don't publish. `dependabot/**` branches
don't publish.

Rules live in [`scripts/release-channel.js`](../scripts/release-channel.js), tested by
`bun run test:scripts`. To see what a commit would publish as:

```bash
GITHUB_REF=refs/heads/$(git branch --show-current) GITHUB_SHA=$(git rev-parse HEAD) node scripts/ci-version.js
```

## What a run does

[`release.yml`](../.github/workflows/release.yml):

1. **version** works out the version and tag ([`ci-version.js`](../scripts/ci-version.js)).
   It fails if a release tag doesn't match the committed version, if the clone is
   shallow, or if another live branch has the same branch id.
2. **test** runs lint and `bun run test`.
3. **publish**, only after both pass:
   1. Stamps the version.
   2. Runs `bun run build:all`. Tests are skipped here because the test job already
      ran them on this SHA.
   3. Publishes every package under the staging tag `ci-g{sha7}` with `--provenance`.
   4. [`promote-dist-tag.js`](../scripts/promote-dist-tag.js) then points the real tag
      at the new version for all packages together, and removes the staging tags.
4. **github-release** (tags only) creates the GitHub Release.

When the real tag moves:

- **Branches and `main`:** only if the run's SHA is still the branch head
  (`git ls-remote`). A re-run of an old commit, or a run after an amend or
  force-push, publishes its version but leaves the tag on the current head.
- **`latest`:** only forward. Re-running an old release tag never moves `latest` back.

Re-running a run is always safe. Packages already on npm at that version are skipped,
and moving the tags is idempotent. The job summary lists the `bun add` lines for the
version.

To try the tag logic locally against the real registry, set `RELEASE_DRY_RUN=1`.
dist-tag writes are then printed instead of run:

```bash
RELEASE_DRY_RUN=1 RELEASE_VERSION=0.6.10 RELEASE_DIST_TAG=next RELEASE_CHANNEL=preview RELEASE_BRANCH=main GITHUB_SHA=$(git ls-remote origin refs/heads/main | cut -f1) node scripts/promote-dist-tag.js
```

When a branch is deleted, [`cleanup-dist-tags.yml`](../.github/workflows/cleanup-dist-tags.yml)
removes its dist-tag and any staging tags its builds left behind. The versions stay on
npm.

## Cutting a release

```bash
bun run new-version            # or: bun run new-version -- 0.7.0
git commit -am "chore: release 0.6.11"
git tag v0.6.11
git push origin main v0.6.11
```

The tag must point at a commit whose committed version matches it, or the run fails
before anything publishes.

Publishing from a laptop (`bun run publish:all`) still works for emergencies if you
have a token. Those versions have no provenance, so downstream deploy gates that
require it (PermaPress) won't accept them.

## Merging

- Merge branches with merge commits or fast-forwards, not squash or rebase. Downstream
  projects pin a branch build and deploy it once its commit is in `main`'s history.
- Rewriting a pushed branch (amend, rebase, force-push) is safe, but any build pinned
  from the old commits never goes live.

## One-time setup

Done by a maintainer with publish rights and 2FA.

1. **Trusted publishers** on npmjs.com, three per package, all for repository
   `JournoLabs/seed-protocol-sdk`:

   | Workflow file | Environment | Publish | Allow npm dist-tag |
   |---|---|---|---|
   | `release.yml` | `release` | Yes | Yes |
   | `release.yml` | `preview` | Yes | Yes |
   | `cleanup-dist-tags.yml` | `cleanup` | Stage publish only (npm requires one) | Yes |

   The configurations can be created with npm 11.15 or later (`--allow-publish`
   is unknown before that). npm 12 needs Node 22 or 24 LTS or Node 26+, so on another
   Node line use `npm install -g npm@11`:

   ```bash
   for p in eas arweave vite query sdk feed feed-hyper gateway-hyper react publish mapping; do
     npm trust github "@seedprotocol/$p" --file release.yml --repo JournoLabs/seed-protocol-sdk --env release --allow-publish -y
     npm trust github "@seedprotocol/$p" --file release.yml --repo JournoLabs/seed-protocol-sdk --env preview --allow-publish -y
     npm trust github "@seedprotocol/$p" --file cleanup-dist-tags.yml --repo JournoLabs/seed-protocol-sdk --env cleanup --allow-stage-publish -y
   done
   ```

   The CLI can't grant dist-tag rights and needs at least one publish permission, so the
   cleanup configuration gets stage publish, which can't go live without 2FA approval.
   "Allow npm dist-tag" is off by default; turn it on for every configuration in the
   package's settings on npmjs.com.
2. **GitHub environments** (Settings → Environments):
   - `release`, with deployment tags limited to `v*`.
   - `preview`, allowing all branches.
   - `cleanup`, with deployment branches limited to `main`.
3. **After the first CI publish succeeds:**
   - Revoke the old npm token and delete the `NPM_TOKEN` repository secret.
   - Set each package to "Require two-factor authentication and disallow tokens".

## Troubleshooting

- **"Tag vX.Y.Z does not match the committed version":** bump with `new-version`,
  commit, and tag that commit. Delete the bad tag first.
- **"would all publish to dist-tag …":** two live branches clean to the same id
  (`feat/x` and `feat-x`). Rename one.
- **A run failed partway:** re-run it. Already-published packages are skipped, and
  the tag only moves once every package is published.
- **Tag "was not moved" in the summary:** a newer commit is on the branch. Its run
  moves the tag.
