import React from 'react'
import { useResolvedMediaRef, type UseResolvedMediaRefParams } from './useResolvedMediaRef'

type ImgProps = React.DetailedHTMLProps<
  React.ImgHTMLAttributes<HTMLImageElement>,
  HTMLImageElement
>

export type SeedMediaImageProps = Omit<ImgProps, 'src'> & {
  value: string | undefined | null
  enabled?: boolean
  treatAs?: UseResolvedMediaRefParams['treatAs']
  /** Custom render; defaults to `<img />`. */
  render?: (props: ImgProps & { src: string }) => React.ReactNode
}

/**
 * Image from a raw feed/XML media string. For local `ItemProperty` images use `SeedImage`.
 */
export function SeedMediaImage({
  value,
  enabled,
  treatAs,
  render,
  alt,
  ...imgProps
}: SeedMediaImageProps): React.ReactNode {
  const { href } = useResolvedMediaRef({ value, enabled, treatAs })
  if (!href) {
    return null
  }
  const merged = { ...imgProps, src: href, alt: alt ?? '' } as ImgProps & { src: string }
  if (render) {
    return <>{render(merged)}</>
  }
  return <img {...merged} />
}
