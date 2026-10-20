import { describe, expect, it } from 'vitest'
import { NESTED_WORKER_SHIM_SOURCE } from '@/browser/db/createSqlocalDrizzle'

type ProbeReply = { href?: string; helperLoaded?: boolean; error?: string }

const probeURL = new URL('./fixtures/nestedWorkerProbe.js', import.meta.url).href
const helperPath = new URL('./fixtures/nestedWorkerHelper.js', import.meta.url).pathname

function blobURL(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
}

/**
 * Starts a module worker that installs the shim, then starts `nestedURL` from inside it the way
 * SQLite starts its OPFS proxy, and relays the nested worker's first reply.
 */
function startNested(
  nestedURL: string,
  nestedOptions: WorkerOptions | undefined,
  message: unknown,
): Promise<ProbeReply> {
  const outerSource = `
    import ${JSON.stringify(blobURL(NESTED_WORKER_SHIM_SOURCE))};
    const nested = new Worker(${JSON.stringify(nestedURL)}, ${nestedOptions ? JSON.stringify(nestedOptions) : 'undefined'});
    nested.onmessage = (event) => self.postMessage(event.data);
    nested.onerror = (event) => self.postMessage({ error: event.message || 'nested worker error' });
    nested.postMessage(${JSON.stringify(message)});
  `
  const outer = new Worker(blobURL(outerSource), { type: 'module' })
  return new Promise<ProbeReply>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nested worker did not reply')), 10_000)
    outer.onmessage = (event) => {
      clearTimeout(timer)
      outer.terminate()
      resolve(event.data as ProbeReply)
    }
    outer.onerror = (event) => {
      clearTimeout(timer)
      outer.terminate()
      reject(new Error(`outer worker failed: ${event.message}`))
    }
  })
}

describe('nested-worker shim', () => {
  it('starts an http classic worker from a blob', async () => {
    const reply = await startNested(probeURL, undefined, {})
    expect(reply.error).toBeUndefined()
    expect(reply.href).toMatch(/^blob:/)
  })

  it('resolves root-relative importScripts in a classic worker against the original URL', async () => {
    const reply = await startNested(probeURL, undefined, { importPath: helperPath })
    expect(reply.error).toBeUndefined()
    expect(reply.helperLoaded).toBe(true)
  })

  it('starts an http module worker from a blob', async () => {
    const reply = await startNested(probeURL, { type: 'module' }, {})
    expect(reply.error).toBeUndefined()
    expect(reply.href).toMatch(/^blob:/)
  })

  it('leaves blob worker URLs alone', async () => {
    const nested = blobURL(
      'self.onmessage = () => self.postMessage({ href: self.location.href })',
    )
    const reply = await startNested(nested, undefined, {})
    expect(reply.href).toBe(nested)
  })
})
