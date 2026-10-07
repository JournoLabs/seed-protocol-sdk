import { waitFor } from '@testing-library/react'

/**
 * Bounded wait for a condition that the calling test tolerates never becoming true.
 * Returns as soon as the condition holds (instead of always sleeping the full time), or false after
 * `timeout`. For conditions the test requires, use waitFor with an expect instead.
 */
export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeout = 2000,
): Promise<boolean> {
  try {
    await waitFor(
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
