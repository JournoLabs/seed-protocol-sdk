import { vi } from 'vitest'

/**
 * Bounded wait for a condition the calling test tolerates never becoming true: returns as soon as the
 * condition holds (instead of always sleeping the full time), or false after `timeout`.
 * When the test needs the condition, use waitUntilOrThrow so a timeout fails the test.
 */
export async function waitUntil(condition: () => boolean | Promise<boolean>, timeout = 2000): Promise<boolean> {
  try {
    await vi.waitFor(
      async () => {
        if (!(await condition())) throw new Error('condition not met yet')
      },
      { timeout, interval: 50 },
    )
    return true
  } catch {
    return false
  }
}

/** Like waitUntil, for a condition the test needs: rejects with `description` after `timeout`. */
export async function waitUntilOrThrow(
  condition: () => boolean | Promise<boolean>,
  description: string,
  timeout = 2000,
): Promise<void> {
  if (!(await waitUntil(condition, timeout))) {
    throw new Error(`Timed out after ${timeout}ms waiting for ${description}`)
  }
}
