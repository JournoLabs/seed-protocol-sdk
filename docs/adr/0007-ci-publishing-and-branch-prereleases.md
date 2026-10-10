# 0007. Publish from CI with trusted publishing, and prerelease every branch

- **Status:** Accepted
- **Date:** 2026-10-06
- **Scope:** `.github/workflows/release.yml`, `.github/workflows/cleanup-dist-tags.yml`,
  `scripts/publish-package.js`, `scripts/release-channel.js` and its CLIs, the
  `repository` field of the 11 public packages

## Context

Releases were published by hand with `bun run publish:all`. `release.yml` had never
worked: it ran `npm publish` on the private root package, and it checked for build
files from an old layout. The tag's version was overwritten by `sync-versions` before
it was used.

PermaPress wants to deploy SDK changes automatically:

- Every SDK branch should have an installable build.
- `main` builds should go to `next`, and releases to `latest`.
- Every build should carry npm provenance. Their deploy gate reads the source commit
  from it, then deploys a pinned branch build once that commit is in `main`'s history.

Facts that shaped the design:

- **npm 11 refuses a prerelease without `--tag`.**
- **Provenance** needs a public repository and a `repository.url` that matches it.
- **Trusted publishing:**
  - Needs npm 11.5.1 or later and Node 22.14 or later.
  - Since 2026-09, a package can have up to 10 configurations.
  - A configuration can manage dist-tags if "Allow npm dist-tag" is on.
  - `npm dist-tag` supports OIDC from npm 12.2.0.
- **npm has no atomic multi-package publish.**

## Decision

Publish only from CI, as described in [RELEASING.md](../RELEASING.md):

- **One shared version, computed from the commit.** Tags publish the committed
  version. Pushes publish `{next patch}-{branch id}.{commit count}.g{sha7}`, never
  committed. The branch id is the cleaned branch name, prefixed with `branch-` when it
  would be reserved or read as a version. A collision between two live branches fails
  the run.
- **Tests once, then publish.** A test job gates the publish job, and the publish job
  builds with tests skipped. The sdk build always runs `build:publish`, so every dist
  check runs on what ships.
- **Publish under a staging tag, then move the real tag.** All packages publish under
  `ci-g{sha7}`. Only then does the real tag move, for all packages together, and the
  staging tags are removed.
- **Rules for moving tags.** Branch tags (and `next`) move only to the branch's
  current head, checked with `git ls-remote`. `latest` moves only forward.
- **Trusted publishing, no token.**
  - Tag builds use a configuration bound to the `release` environment (`v*` tags only).
  - Branch builds use one bound to `preview`.
  - Branch deletion runs `cleanup-dist-tags.yml` under a configuration that can only
    manage dist-tags.

## Consequences

- **Releases:** a release is `new-version`, commit, tag, push. A tag that doesn't
  match the committed version fails before anything publishes.
- **npm clutter:** every push that changes code publishes 11 prerelease versions that
  stay on npm for good. Branch dist-tags are removed when the branch is deleted.
- **Shared publishing rights:** anyone who can push a branch can run the `preview`
  publish path. That path can technically publish any version under any tag, so
  write access to this repo must stay limited to trusted maintainers. npm's staged
  publishing (2FA approval per publish) would close this, at the cost of manual
  approvals on every build.
- **Laptop publishes:** these carry no provenance, so PermaPress won't deploy them.
- **Rewriting branches:** amending or force-pushing a pushed branch orphans builds
  pinned from the old commits. They never go live, which fails safe.
- **Superseded commits:** concurrency allows one waiting run per branch, so a commit
  replaced by a newer push before its run starts may never be published.

## Alternatives considered

- **pkg.pr.new for branch builds.** It's what Vite, Vue and Svelte use for previews,
  and it avoids npm clutter. But it gives no npm provenance, and production would be
  installing from a third-party preview registry.
- **Changesets.** Independent versions and changelogs per package aren't needed:
  `sync-versions` already keeps one shared version.
- **`repository_dispatch` to PermaPress after each `main` build.** This needs a
  long-lived cross-repo token stored here. PermaPress follows `next` with Renovate
  instead.
- **"Only forward" for branch tags.** After an amend the commit count is unchanged,
  so the order falls to the SHA's letters. A force-push lowers the count. Either way
  the tag could stick on a commit the branch no longer has.
