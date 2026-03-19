/**
 * Debug instrumentation for schema/init diagnostics.
 * Logs are sent to the debug ingest endpoint and written to .cursor/debug-*.log
 */
const DEBUG_ENDPOINT = 'http://127.0.0.1:7242/ingest/2810478a-7cf0-49a8-bc23-760b81417972'
const SESSION_ID = '7ffc49'

export function debugLog(
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  hypothesisId?: string,
  runId?: string
) {
  const payload = {
    sessionId: SESSION_ID,
    location,
    message,
    data,
    timestamp: Date.now(),
    ...(hypothesisId && { hypothesisId }),
    ...(runId && { runId }),
  }
  fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': SESSION_ID },
    body: JSON.stringify(payload),
  }).catch(() => {})
}
