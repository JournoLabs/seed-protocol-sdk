import React from 'react'
import { useResolvedMediaRef, type UseResolvedMediaRefParams } from './useResolvedMediaRef'

type VideoProps = React.DetailedHTMLProps<
  React.VideoHTMLAttributes<HTMLVideoElement>,
  HTMLVideoElement
>

export type SeedMediaVideoProps = Omit<VideoProps, 'src'> & {
  value: string | undefined | null
  enabled?: boolean
  treatAs?: UseResolvedMediaRefParams['treatAs']
  /** Custom render; defaults to `<video controls />`. */
  render?: (props: VideoProps & { src: string }) => React.ReactNode
}

/**
 * Video from a raw feed/XML media string. Storage remains File/Image schema types;
 * this helper only picks the browser element.
 */
export function SeedMediaVideo({
  value,
  enabled,
  treatAs,
  render,
  controls = true,
  ...videoProps
}: SeedMediaVideoProps): React.ReactNode {
  const { href } = useResolvedMediaRef({ value, enabled, treatAs })
  if (!href) {
    return null
  }
  const merged = { ...videoProps, src: href, controls } as VideoProps & {
    src: string
  }
  if (render) {
    return <>{render(merged)}</>
  }
  return <video {...merged} />
}
