const hashLargeString = async ( input: string, ): Promise<string> => {
  // Convert the string to an ArrayBuffer
  const encoder = new TextEncoder()
  const data = encoder.encode(input,)

  // Hash the data with SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', data,)

  // Convert the ArrayBuffer to a hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer,),)
  const hashHex = hashArray.map(( b, ) => b.toString(16,).padStart(2, '0',),).join('',)

  return hashHex
}

onmessage = async (event,) => {
  postMessage('Content hash worker received message',)
  if (!event || !event.data || !event.data.trackingId || !event.data.base64) {
    postMessage('No event data received',)
    return
  }
  const { trackingId, base64, } = event.data
  postMessage('Beginning content hash calculation',)
  const contentHash = await hashLargeString(base64,)
  postMessage('Content hash calculation complete',)
  postMessage({
    trackingId,
    contentHash,
  },)
}