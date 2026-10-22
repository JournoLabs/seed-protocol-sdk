# Image for `bun run ci:local --docker` (scripts/ci-local.js passes every build arg):
# the Playwright Linux image matching bun.lock's playwright, Node from .nvmrc, Bun from
# release.yml's BUN_VERSION. pipx runs bagit-python for @seedprotocol/archive's BagIt tests.
ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG NODE_MAJOR
ARG BUN_VERSION

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl pipx unzip xz-utils \
 && rm -rf /var/lib/apt/lists/*

# Latest Node of the .nvmrc major, as actions/setup-node resolves it, checked against SHASUMS256.
RUN set -eu; \
    arch="$(dpkg --print-architecture | sed 's/amd64/x64/')"; \
    base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"; \
    cd /tmp; \
    curl -fsSLO "$base/SHASUMS256.txt"; \
    file="$(grep -o "node-v[0-9.]*-linux-${arch}.tar.xz" SHASUMS256.txt)"; \
    curl -fsSLO "$base/$file"; \
    grep " $file\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "$file" -C /usr/local --strip-components=1; \
    rm -f "$file" SHASUMS256.txt

RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v${BUN_VERSION}"

RUN node --version && bun --version
