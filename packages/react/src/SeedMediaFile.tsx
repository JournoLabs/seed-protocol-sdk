import React from 'react'
import { useResolvedMediaRef, type UseResolvedMediaRefParams } from './useResolvedMediaRef'

type AnchorProps = React.DetailedHTMLProps<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  HTMLAnchorElement
>

function defaultLabelFromHref(href: string): string {
  try {
    const u = new URL(href)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    return seg || 'Open'
  } catch {
    return 'Open'
  }
}

function isHttpOrHttps(href: string): boolean {
  try {
    const p = new URL(href).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

export type SeedMediaFileProps = Omit<AnchorProps, 'href'> & {
  value: string | undefined | null
  enabled?: boolean
  treatAs?: UseResolvedMediaRefParams['treatAs']
  download?: string | boolean
  /** Custom render; defaults to `<a />`. */
  render?: (props: AnchorProps & { href: string }) => React.ReactNode
}

/**
 * Link for a raw feed/XML file URL (or tx id / seed UID string resolved like images).
 * For local synced `File` item properties, build download UI with `useItemProperty` / file paths.
 */
export function SeedMediaFile({
  value,
  enabled,
  treatAs,
  download,
  render,
  children,
  target,
  rel,
  ...anchorProps
}: SeedMediaFileProps): React.ReactNode {
  const { href } = useResolvedMediaRef({ value, enabled, treatAs })
  if (!href) {
    return null
  }
  const external = isHttpOrHttps(href)
  const resolvedTarget = target !== undefined ? target : external ? '_blank' : undefined
  const merged = {
    ...anchorProps,
    href,
    download,
    target: resolvedTarget,
    rel:
      rel ??
      (external && resolvedTarget === '_blank' ? 'noopener noreferrer' : undefined),
    children: children ?? defaultLabelFromHref(href),
  } as AnchorProps & { href: string }
  if (render) {
    return <>{render(merged)}</>
  }
  return <a {...merged} />
}
