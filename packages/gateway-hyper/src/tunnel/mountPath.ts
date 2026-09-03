/**
 * Strip a mount path prefix from an incoming request URL path (including query string).
 * If the path is already unmounted (framework stripped it), returns it unchanged (with leading `/`).
 */
export function stripMountPath(urlPath: string, mountPath: string): string {
  const raw = urlPath || '/'
  const qIndex = raw.indexOf('?')
  const pathname = qIndex === -1 ? raw : raw.slice(0, qIndex)
  const query = qIndex === -1 ? '' : raw.slice(qIndex)

  const mount = (mountPath || '').replace(/\/$/, '')
  if (!mount || mount === '/') {
    const path = pathname.startsWith('/') ? pathname : `/${pathname}`
    return `${path}${query}` || '/'
  }

  if (pathname === mount || pathname.startsWith(`${mount}/`)) {
    const rest = pathname.slice(mount.length)
    const path = rest.startsWith('/') ? rest : rest ? `/${rest}` : '/'
    return `${path}${query}`
  }

  // Already stripped by the framework (e.g. Express mount)
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${path}${query}`
}
