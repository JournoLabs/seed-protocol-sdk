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
    bc.onmessage = (e) => self.postMessage({ type: 'heard', message: e.data })
    self.postMessage({ type: 'listening' })
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
  return { worker, send, heard }
}

export type OtherTab = ReturnType<typeof otherTab>
