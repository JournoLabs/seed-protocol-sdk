import { spawnSync } from 'node:child_process'

/**
 * The Library of Congress reference validator (bagit-python, `bagit.py --validate`), as a
 * command prefix, or undefined when none runs. `BAGIT_PY` names a command to use; otherwise
 * `bagit.py` on PATH, then `uvx` or `pipx run` with bagit 1.9.0 from PyPI. GitHub's runners and
 * the ci:local Docker image have pipx. Under CI a missing validator fails the test instead of
 * skipping it.
 */
export function findBagitPy(): string[] | undefined {
  const candidates = [
    ...(process.env.BAGIT_PY ? [process.env.BAGIT_PY.split(' ')] : []),
    ['bagit.py'],
    ['uvx', '--from', 'bagit==1.9.0', 'bagit.py'],
    ['pipx', 'run', '--spec', 'bagit==1.9.0', 'bagit.py'],
  ]
  for (const command of candidates) {
    const [bin, ...args] = command as [string, ...string[]]
    const probe = spawnSync(bin, [...args, '--version'], { encoding: 'utf8' })
    if (probe.status === 0) return command
  }
  return undefined
}

export const bagitPyRequired = (): boolean => !!process.env.CI

/** Runs `bagit.py --validate` on `directory`; returns its exit status and combined output. */
export function runBagitPy(command: string[], directory: string): { status: number | null; output: string } {
  const [bin, ...args] = command as [string, ...string[]]
  const result = spawnSync(bin, [...args, '--validate', directory], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}
