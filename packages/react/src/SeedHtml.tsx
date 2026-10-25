import React from 'react'
import { mapUrlAttribute, nextArweaveGatewayUrl, rehostArweaveLinksInHtml } from '@seedprotocol/sdk'

type DivProps = Omit<
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>,
  'dangerouslySetInnerHTML' | 'children'
>

export type SeedHtmlProps = DivProps & {
  html: string | null | undefined
  /** App-supplied sanitizer (e.g. DOMPurify). The SDK does not ship a default policy. */
  sanitize: (raw: string) => string
  /**
   * If set, receive sanitized HTML and render your own container; no innerHTML is set by SeedHtml.
   * Attach {@link attachArweaveLoadFailover} to that container to keep the load failover.
   */
  render?: (props: { html: string }) => React.ReactNode
}

function hasRenderableHtml(html: string | null | undefined): html is string {
  return typeof html === 'string' && html.trim().length > 0
}

const MEDIA_TAGS = new Set(['img', 'video', 'audio', 'source'])
const URL_ATTRIBUTES = ['src', 'srcset', 'poster'] as const

/**
 * When an `img`, `video`, `audio` or `source` inside `container` fails to load an Arweave link,
 * moves it to the same transaction on the next read gateway (ADR 0025). Load errors don't bubble,
 * so this listens in the capture phase. Returns a function that removes the listener.
 */
export function attachArweaveLoadFailover(container: HTMLElement): () => void {
  const onError = (event: Event) => {
    const el = event.target
    if (!(el instanceof Element) || !MEDIA_TAGS.has(el.tagName.toLowerCase())) return
    let moved = false
    for (const name of URL_ATTRIBUTES) {
      const value = el.getAttribute(name)
      if (!value) continue
      const next = mapUrlAttribute(name, value, (url) => nextArweaveGatewayUrl(url))
      if (next === undefined) continue
      el.setAttribute(name, next)
      moved = true
    }
    // A <source> is only read again when its media element reloads
    if (moved && el.tagName.toLowerCase() === 'source') {
      const media = el.parentElement as HTMLMediaElement | null
      media?.load?.()
    }
  }
  container.addEventListener('error', onError, true)
  return () => container.removeEventListener('error', onError, true)
}

/**
 * Renders HTML from an `Html` property, feed field, or other source using a required sanitizer.
 * Arweave links are moved onto this reader's read gateways before `sanitize` runs (so a sanitizer
 * that drops unknown schemes never sees `ar://`), and media that fail to load move to the next
 * gateway. For plain-text display of markup, use `{String(value)}` instead.
 */
export function SeedHtml({
  html,
  sanitize,
  render,
  ...divProps
}: SeedHtmlProps): React.ReactNode {
  const ref = React.useRef<HTMLDivElement>(null)
  const safe = React.useMemo(
    () => (hasRenderableHtml(html) ? sanitize(rehostArweaveLinksInHtml(html)) : undefined),
    [html, sanitize],
  )
  React.useEffect(() => {
    const container = ref.current
    return container ? attachArweaveLoadFailover(container) : undefined
  }, [safe, render])

  if (safe === undefined) {
    return null
  }
  if (render) {
    return <>{render({ html: safe })}</>
  }
  return <div {...divProps} ref={ref} dangerouslySetInnerHTML={{ __html: safe }} />
}
