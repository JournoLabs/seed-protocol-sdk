// Spike probe: start a worker from inside this worker and report what happens.
self.onmessage = (event) => {
  const { url, base } = event.data
  let resolved
  try {
    resolved = base ? new URL(url, base === 'self' ? self.location.href : base).href : url
  } catch (err) {
    postMessage({ url, step: 'resolve', error: String(err), location: self.location.href })
    return
  }
  try {
    const w = new Worker(resolved)
    w.onerror = (e) => postMessage({ url: resolved, step: 'onerror', message: e.message, filename: e.filename, location: self.location.href })
    w.onmessage = (m) => postMessage({ url: resolved, step: 'message', data: m.data, location: self.location.href })
  } catch (err) {
    postMessage({ url: resolved, step: 'construct', error: String(err), location: self.location.href })
  }
}
