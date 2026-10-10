// Imports nothing, so packages/react tests can share it.

/**
 * Timeout for a wait on something that should happen (an entity reaching idle, a write finishing, a
 * message from another tab). Healthy waits take well under a second; this is headroom for CI, where
 * the suite runs ~2× slower than on a dev machine with several test files at once. Keep it below the
 * 30s testTimeout in vite.config.js so a stuck wait fails with its own message, not the test's.
 */
export const WAIT_TIMEOUT_MS = 15_000
