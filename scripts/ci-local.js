#!/usr/bin/env node
/**
 * Runs the Release workflow's "Lint and test" job (jobs.test in .github/workflows/release.yml)
 * on this machine, so a merge to main doesn't find its lint, lockfile or test failures. The
 * steps are the job's own `run:` steps, read from the workflow, in order; the first failure
 * stops the run.
 *
 * Usage: node scripts/ci-local.js [--repeat N] [--docker [--cpus 2] [--memory 7g]]
 *
 *   --repeat N   run the test step (`bun run test`) N times, to surface timing races
 *   --docker     run the job inside the Playwright Linux image sized like GitHub's
 *                ubuntu-latest runner (scripts/ci-docker/Dockerfile); see docs/TESTING.md
 *
 * `--with-deps` is dropped from `playwright install`: it apt-installs Chromium's system
 * libraries, which macOS doesn't need and the Docker image already has. Step `env` values that
 * are GitHub expressions (`${{ secrets.… }}`) are skipped, so a variable set in your shell wins.
 */

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(rootDir, '.github/workflows/release.yml')

const JOB = 'test'
const TEST_STEP = 'bun run test'
const IMAGE = 'seed-ci-local'
const STEPS_ENV = 'CI_LOCAL_STEPS'

async function loadWorkflow() {
  let yaml
  try {
    yaml = (await import('js-yaml')).default
  } catch {
    throw new Error('js-yaml is missing: run `bun install` once, then retry.')
  }
  return yaml.load(fs.readFileSync(workflowPath, 'utf8'))
}

/** The job's `run:` steps as `{ command, env }`, in workflow order. */
export function jobSteps(workflow, job = JOB) {
  const steps = workflow?.jobs?.[job]?.steps
  if (!Array.isArray(steps)) throw new Error(`release.yml has no jobs.${job}.steps`)
  return steps
    .filter((step) => typeof step.run === 'string')
    .map((step) => ({
      command: step.run.trim().replace(/\s--with-deps\b/, ''),
      env: Object.fromEntries(
        Object.entries(step.env ?? {})
          .filter(([, value]) => !String(value).includes('${{'))
          .map(([key, value]) => [key, String(value)]),
      ),
    }))
}

export function parseArgs(argv) {
  const options = { repeat: 1, docker: false, cpus: '2', memory: '7g' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--docker') options.docker = true
    else if (arg === '--repeat' || arg === '--cpus' || arg === '--memory') {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} needs a value`)
      options[arg.slice(2)] = arg === '--repeat' ? Number.parseInt(value, 10) : value
    } else throw new Error(`Unknown option ${arg}`)
  }
  if (!Number.isInteger(options.repeat) || options.repeat < 1) {
    throw new Error('--repeat must be a positive integer')
  }
  return options
}

function run(command, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      stdio: 'inherit',
      shell: true,
      cwd: rootDir,
      env: { ...process.env, ...env },
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`\`${command}\` failed with exit code ${code}`))
    })
    proc.on('error', reject)
  })
}

const seconds = (start) => `${((Date.now() - start) / 1000).toFixed(1)}s`

async function runSteps(steps, repeat) {
  const timings = []
  const start = Date.now()
  try {
    for (const step of steps) {
      const runs = step.command === TEST_STEP ? repeat : 1
      for (let i = 1; i <= runs; i++) {
        const label = runs > 1 ? `${step.command} (${i}/${runs})` : step.command
        console.log(`\n▶ ${label}\n`)
        const stepStart = Date.now()
        try {
          await run(step.command, step.env)
        } finally {
          timings.push([label, seconds(stepStart)])
        }
      }
    }
  } finally {
    console.log('\nStep timings:')
    for (const [label, time] of timings) console.log(`  ${time.padStart(8)}  ${label}`)
    console.log(`  ${seconds(start).padStart(8)}  total`)
  }
}

function playwrightVersion() {
  const lock = fs.readFileSync(path.join(rootDir, 'bun.lock'), 'utf8')
  const match = lock.match(/"playwright": \["playwright@([^"]+)"/)
  if (!match) throw new Error('No playwright entry in bun.lock')
  return match[1]
}

/** Files a CI checkout would have, plus untracked files that aren't gitignored. */
function checkoutFiles() {
  const out = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`)
  return out.stdout.split('\0').filter((file) => file && fs.existsSync(path.join(rootDir, file)))
}

const WATCH_INTERVAL_MS = 30_000

/**
 * `docker run` keeps waiting when its container is removed under it (a Docker Desktop
 * restart, `docker rm -f`), so this fails the run once the container is missing on two
 * checks in a row. Two, because a container that just exited is removed by `--rm` before
 * the client's own exit arrives.
 */
function watchContainer(name, docker, reject) {
  let misses = 0
  const timer = setInterval(() => {
    const inspect = spawnSync('docker', ['inspect', '-f', '{{.State.Status}}', name], { encoding: 'utf8' })
    misses = inspect.status === 0 ? 0 : misses + 1
    if (misses < 2) return
    clearInterval(timer)
    docker.kill()
    reject(new Error(`container ${name} disappeared while \`docker run\` was still waiting`))
  }, WATCH_INTERVAL_MS)
  docker.on('close', () => clearInterval(timer))
}

async function runDocker(workflow, options) {
  const versions = {
    PLAYWRIGHT_VERSION: playwrightVersion(),
    NODE_MAJOR: fs.readFileSync(path.join(rootDir, '.nvmrc'), 'utf8').trim(),
    BUN_VERSION: String(workflow.env.BUN_VERSION),
  }
  const tag = `${IMAGE}:pw${versions.PLAYWRIGHT_VERSION}-node${versions.NODE_MAJOR}-bun${versions.BUN_VERSION}`
  const buildArgs = Object.entries(versions).map(([key, value]) => `--build-arg ${key}=${value}`)
  await run(`docker build -q -t ${tag} ${buildArgs.join(' ')} scripts/ci-docker`)

  // The repo goes in as a tar stream, not a mount, so the container installs its own Linux
  // node_modules and builds its own dist instead of reusing the host's.
  const inner = [
    'mkdir -p /work',
    'tar -x --no-same-owner --warning=no-unknown-keyword -C /work',
    'cd /work',
    `node scripts/ci-local.js --repeat ${options.repeat}`,
  ].join(' && ')
  // The container has no node_modules (so no js-yaml) until its install step, so the host
  // reads the steps and hands them over.
  const steps = JSON.stringify(jobSteps(workflow))
  const name = `${IMAGE}-${process.pid}`
  const dockerArgs = [
    'run', '--rm', '-i', '--name', name,
    `--cpus=${options.cpus}`, `--memory=${options.memory}`, `--memory-swap=${options.memory}`,
    // Playwright's recommendation for Chromium; Docker's default 64 MB /dev/shm crashes it.
    '--ipc=host',
    '-e', 'CI=true',
    '-e', `${STEPS_ENV}=${steps}`,
    ...(process.env.SEED_GATEWAY_HYPER_KEY ? ['-e', 'SEED_GATEWAY_HYPER_KEY'] : []),
    // Bun's download cache only; node_modules is rebuilt in the container every run.
    '-v', `${IMAGE}-bun-cache:/root/.bun/install/cache`,
    tag, 'bash', '-c', inner,
  ]
  console.log(`\n▶ docker run --cpus=${options.cpus} --memory=${options.memory} ${tag}\n`)

  const start = Date.now()
  const tar = spawn('tar', ['--no-mac-metadata', '--no-xattrs', '--null', '-T', '-', '-cf', '-'], {
    cwd: rootDir,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const docker = spawn('docker', dockerArgs, { stdio: [tar.stdout, 'inherit', 'inherit'] })
  tar.stdin.end(checkoutFiles().join('\0'))
  const code = await new Promise((resolve, reject) => {
    docker.on('close', resolve)
    docker.on('error', reject)
    watchContainer(name, docker, reject)
  })
  console.log(`\nDocker run: ${seconds(start)} (includes image start and repo copy)`)
  if (code !== 0) throw new Error(`docker run failed with exit code ${code}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (process.env[STEPS_ENV]) return runSteps(JSON.parse(process.env[STEPS_ENV]), options.repeat)
  const workflow = await loadWorkflow()
  if (options.docker) await runDocker(workflow, options)
  else await runSteps(jobSteps(workflow), options.repeat)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n❌ ${error.message}`)
    process.exit(1)
  })
}
