// Shared by packages/publish bun tests. Lives outside src/ so the build (tsconfig.build.json) skips it.
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

export { WAIT_TIMEOUT_MS }

/** Per-test timeout for tests that use waitUntilOrThrow (bun's default is 5s), so a stuck wait fails with its own message. */
export const TEST_TIMEOUT_MS = 30_000

/**
 * Wait for a condition the test needs: polls until it holds, or rejects with `description` after
 * `timeout` (15s by default, headroom for slow CI; healthy waits finish in milliseconds).
 */
export async function waitUntilOrThrow(
  condition: () => boolean | Promise<boolean>,
  description: string,
  timeout = WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeout
  while (true) {
    if (await condition()) return
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeout}ms waiting for ${description}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}
