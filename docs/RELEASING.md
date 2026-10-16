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

Pushes that only change `docs/**` or `*.md` don't publish. A branch push whose commit
is already tagged `v{committed version}` doesn't publish either: the tag's run tests and
publishes that commit, so the branch run stops after **version**. `dependabot/**` branches
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
bun run release                 # next patch, e.g. 0.7.2 → 0.7.3
bun run release -- 0.8.0        # explicit version
bun run release -- --dry-run    # checks and plan only
bun run release -- --retry      # re-release a version whose tag run failed before publishing
```

[`release.js`](../scripts/release.js) checks that you're on `main` with a clean
tree and not behind `origin/main`. It also checks that the version is plain
`X.Y.Z`, newer than both the committed version and npm `latest`, and not already
published, and that the tag doesn't exist yet. It fails if the Release run for
the current commit failed; pass `--skip-ci-check` to override, or if `gh` isn't
available it only warns. It then prints the plan and the commits since the last
release, and asks you to type the version to confirm.

On confirmation it bumps every package, commits `chore: release X.Y.Z`, creates an
annotated tag `vX.Y.Z`, and pushes `main` and the tag in one atomic push. If the
push fails, it removes the local commit and tag again.

By hand, the same thing is:

```bash
bun run new-version -- 0.7.3
git commit -am "chore: release 0.7.3"
git tag v0.7.3
git push --atomic origin main v0.7.3
```

The tag must point at a commit whose committed version matches it, or the run fails
before anything publishes.

### When a release fails before publishing

If the tag's run fails before any package reaches npm (a flaky test, say), the version
is still unused: npm only makes a version permanent once it's published. Fix the
problem on `main`, then:

```bash
bun run release -- --retry
```

It moves the committed version's tag from the failed commit to HEAD and pushes it,
which starts a new tag run. HEAD must contain the old tag's commit, and the old run
must have finished. Like a new release, it checks CI for HEAD, prints the plan, and
asks you to type the version.

It refuses when some packages already published that version. npm can't replace them,
so re-run the failed run instead: it publishes the rest from the same commit.

If you'd rather skip the version, cut the next one as usual. When that release
succeeds, the GitHub Release job deletes older `vX.Y.Z` tags whose version is on npm
for no package ([`prune-unreleased-tags.js`](../scripts/prune-unreleased-tags.js)),
and starts the changelog at the last tag that did publish, so the skipped tag's
changes still appear. Tags with a Release run still going are kept.

Push `main` and the tag together, as above. The `main` run then sees the tag and skips,
so only the tag run tests and publishes. If `main` goes up first, its run publishes a
`-next` prerelease of the release commit as usual.

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
- **A tag run failed before publishing anything:** fix it on `main`, then
  `bun run release -- --retry`. See [When a release fails before
  publishing](#when-a-release-fails-before-publishing).
- **"… is not on the registry; not moving any tags":** npm's reads lag its publishes,
  sometimes by minutes. The promote step waits up to 10 minutes for every package
  (`RELEASE_REGISTRY_WAIT_MS`). If it still gives up, re-run the job: everything is
  already published, so it goes straight to promoting.
- **Tag "was not moved" in the summary:** a newer commit is on the branch. Its run
  moves the tag.
