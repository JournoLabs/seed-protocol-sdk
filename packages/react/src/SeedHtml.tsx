import React from 'react'

type DivProps = Omit<
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>,
  'dangerouslySetInnerHTML' | 'children'
>

export type SeedHtmlProps = DivProps & {
  html: string | null | undefined
  /** App-supplied sanitizer (e.g. DOMPurify). The SDK does not ship a default policy. */
  sanitize: (raw: string) => string
  /** If set, receive sanitized HTML and render your own container; no innerHTML is set by SeedHtml. */
  render?: (props: { html: string }) => React.ReactNode
}

function hasRenderableHtml(html: string | null | undefined): html is string {
  return typeof html === 'string' && html.trim().length > 0
}

/**
 * Renders HTML from an `Html` property, feed field, or other source using a required sanitizer.
 * For plain-text display of markup, use `{String(value)}` instead.
 */
export function SeedHtml({
  html,
  sanitize,
  render,
  ...divProps
}: SeedHtmlProps): React.ReactNode {
  if (!hasRenderableHtml(html)) {
    return null
  }
  const safe = sanitize(html)
  if (render) {
    return <>{render({ html: safe })}</>
  }
  return <div {...divProps} dangerouslySetInnerHTML={{ __html: safe }} />
}
