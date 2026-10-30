/**
 * A dedicated worker shares the origin's Web Locks and BroadcastChannels, so it stands in for
 * another tab: it can hold the leader lock and post tab messages.
 */
const OTHER_TAB_SOURCE = `
let release
self.onmessage = (event) => {
  const { type, name, channel, message } = event.data
  if (type === 'lead') {
    navigator.locks.request(name, () => {
      self.postMessage({ type: 'leading' })
      return new Promise((resolve) => (release = resolve))
    })
  }
  if (type === 'step-down') {
    release?.()
    self.postMessage({ type: 'stepped-down' })
  }
  if (type === 'listen') {
    const bc = new BroadcastChannel(channel)
    bc.onmessage = (e) => {
      if (e.data && e.data.__otherTabProbe) self.postMessage({ type: 'probe-heard' })
      else self.postMessage({ type: 'heard', message: e.data })
    }
  }
  if (type === 'hold-shared') {
    navigator.locks.request(name, { mode: 'shared' }, () => {
      self.postMessage({ type: 'holding-shared' })
      return new Promise((resolve) => (self.releaseShared = resolve))
    })
  }
  if (type === 'hold-file') {
    // As SQLite's OPFS VFS does: a sync access handle keeps the file from being removed.
    ;(async () => {
      let dir = await navigator.storage.getDirectory()
      const parts = event.data.path.split('/').filter(Boolean)
      const file = parts.pop()
      for (const part of parts) dir = await dir.getDirectoryHandle(part)
      self.heldFile = await (await dir.getFileHandle(file)).createSyncAccessHandle()
      self.postMessage({ type: 'holding-file' })
    })()
  }
  if (type === 'release-file') {
    self.heldFile?.close()
    self.releaseShared?.()
    self.postMessage({ type: 'released-file' })
  }
  if (type === 'post') {
    new BroadcastChannel(channel).postMessage(message)
    self.postMessage({ type: 'posted' })
  }
}
`

export function otherTab() {
  const worker = new Worker(URL.createObjectURL(new Blob([OTHER_TAB_SOURCE], { type: 'text/javascript' })))
  const heard: unknown[] = []
  const send = (data: Record<string, unknown>, reply: string) =>
    new Promise<void>((resolve) => {
      const onMessage = (event: MessageEvent) => {
        if (event.data.type === reply) {
          worker.removeEventListener('message', onMessage)
          resolve()
        }
      }
      worker.addEventListener('message', onMessage)
      worker.postMessage(data)
    })
  worker.addEventListener('message', (event) => {
    if (event.data.type === 'heard') heard.push(event.data.message)
  })

  /**
   * Subscribes the other tab to `channel` and resolves once it receives messages on it. A new
   * BroadcastChannel registers asynchronously in Chromium, so a message posted right after it's
   * constructed can be dropped (CI run 38092037319 lost the first of two). Posts probes until one
   * arrives; probes don't show up in `heard`.
   */
  const listen = async (channel: string) => {
    const heardProbe = send({ type: 'listen', channel }, 'probe-heard')
    const probe = new BroadcastChannel(channel)
    let waiting = true
    void heardProbe.then(() => (waiting = false))
    try {
      while (waiting) {
        probe.postMessage({ __otherTabProbe: true })
        await Promise.race([heardProbe, new Promise((resolve) => setTimeout(resolve, 20))])
      }
    } finally {
      probe.close()
    }
  }
  return { worker, send, listen, heard }
}

export type OtherTab = ReturnType<typeof otherTab>
